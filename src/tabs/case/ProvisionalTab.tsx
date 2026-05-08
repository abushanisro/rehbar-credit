/**
 * ProvisionalTab — Monthly / Quarterly / YTD financial analysis.
 *
 * Features:
 *  • Add provisional periods: Monthly, Q1-Q4, H1/H2, 9-Month, YTD, Annual
 *  • Import from Excel (round-trip template format)
 *  • Export to Excel (editable template — import back after editing)
 *  • Full P&L + BS table, columns = periods, with inline editing
 *  • Annualized column (projects period values to 12-month equivalent)
 *  • Comparison against last confirmed audited year
 *
 * Storage: ic_note.provisional (JSON array of ProvPeriod).
 */

import { useState, useRef } from "react";
import { Panel } from "@/components/terminal/Panel";
import type { CaseRow, ExtractedRow, LineItem } from "@/features/case/types";
import { unitAbbr, fmtUnit } from "@/features/case/utils";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type PeriodType = "monthly" | "quarterly" | "half_yearly" | "nine_month" | "ytd" | "annual";

export interface ProvPeriod {
  id: string;
  label: string;
  period_type: PeriodType;
  fiscal_year: number;
  months_covered: number;
  unit: string;
  pl: LineItem[];
  bs: LineItem[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const PL_LABELS = [
  "Turnover", "Cost of Goods Sold", "Gross Profit",
  "Operating Expenses", "EBITDA", "Depreciation", "EBIT",
  "Interest Expense", "Profit Before Tax", "Tax", "PAT",
];
const BS_LABELS = [
  "Net Worth", "Long Term Borrowings", "Short Term Borrowings", "Total Debt",
  "Current Liabilities", "Total Liabilities",
  "Fixed Assets (Net)", "Inventory", "Trade Receivables",
  "Cash & Bank", "Current Assets", "Total Assets",
];

const PERIOD_TYPE_META: Record<PeriodType, { label: string; defaultMonths: number }> = {
  monthly:     { label: "Monthly (1M)",    defaultMonths: 1  },
  quarterly:   { label: "Quarterly (3M)",  defaultMonths: 3  },
  half_yearly: { label: "Half-Year (6M)",  defaultMonths: 6  },
  nine_month:  { label: "9 Months",        defaultMonths: 9  },
  ytd:         { label: "YTD (custom)",    defaultMonths: 6  },
  annual:      { label: "Annual (12M)",    defaultMonths: 12 },
};

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getv(items: LineItem[], label: string): number | null {
  const it = items.find(i => i.label === label);
  if (!it) return null;
  return it.override_value != null ? it.override_value : it.value;
}

function setv(items: LineItem[], label: string, value: number | null): LineItem[] {
  const idx = items.findIndex(i => i.label === label);
  if (idx === -1) return [...items, { label, value, confidence: 100, reviewed: true, override_value: null }];
  const next = [...items];
  next[idx] = { ...next[idx], value };
  return next;
}

function blank(labels: string[]): LineItem[] {
  return labels.map(l => ({ label: l, value: null, confidence: 100, reviewed: true, override_value: null }));
}

function annualize(v: number | null, mc: number): number | null {
  if (v == null || mc <= 0 || mc >= 12) return null;
  return (v / mc) * 12;
}

function fmtN(n: number | null, dec = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function growthCls(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  return v > 0 ? "text-success" : v < 0 ? "text-destructive" : "text-muted-foreground";
}

function growthLabel(curr: number | null, prev: number | null): string {
  if (curr == null || prev == null || prev === 0) return "—";
  const g = ((curr - prev) / Math.abs(prev)) * 100;
  return (g > 0 ? "+" : "") + g.toFixed(1) + "%";
}

function suggestLabel(type: PeriodType, fy: number, months: number, extra?: { month?: number; quarter?: number; half?: number }): string {
  const fyShort = String(fy).slice(2);
  if (type === "monthly" && extra?.month) return `${MONTH_NAMES[(extra.month - 1) % 12]} FY${fyShort}`;
  if (type === "quarterly" && extra?.quarter) return `Q${extra.quarter} FY${fyShort}`;
  if (type === "half_yearly" && extra?.half) return `H${extra.half} FY${fyShort}`;
  if (type === "nine_month") return `9M FY${fyShort}`;
  if (type === "ytd") return `${months}M YTD FY${fyShort}`;
  if (type === "annual") return `FY${fy}`;
  return `${months}M FY${fyShort}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXCEL EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

async function exportProvisionalExcel(periods: ProvPeriod[], caseCode: string) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const labels = periods.map(p => p.label);

  for (const [section, sectionLabels] of [["P&L", PL_LABELS], ["Balance Sheet", BS_LABELS]] as const) {
    const rows: (string | number | null)[][] = [];
    // Header row
    rows.push(["PARTICULARS", ...labels]);
    // Meta rows (round-trip data)
    rows.push(["__months_covered__", ...periods.map(p => p.months_covered)]);
    rows.push(["__fiscal_year__",    ...periods.map(p => p.fiscal_year)]);
    rows.push(["__period_type__",    ...periods.map(p => p.period_type)]);
    rows.push(["__unit__",           ...periods.map(p => p.unit)]);
    // Separator
    rows.push(["---"]);

    for (const label of sectionLabels) {
      const key = section === "P&L" ? "pl" : "bs";
      rows.push([label, ...periods.map(p => getv(p[key as "pl" | "bs"], label) ?? "")]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, section.slice(0, 31));
  }
  XLSX.writeFile(wb, `${caseCode}_provisional.xlsx`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXCEL IMPORT
// ═══════════════════════════════════════════════════════════════════════════════

// ── Indian number format: "14,80,091.00" → 1480091 ────────────────────────
function parseIndianNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).replace(/,/g, "").trim();
  if (!s || s === "-" || s === "—") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ── Detect FY from filename — "FY25-26", "FY2024-25", "2024-2025", etc. ────
function detectFYFromFilename(filename: string): number | null {
  // Strip path separators so only the basename is matched
  const base = filename.replace(/.*[/\\]/, "");
  // Match any two numbers separated by a dash/en-dash (with optional "FY" prefix)
  const m = base.match(/(?:FY\s*)?(\d{2,4})\s*[-–—]\s*(\d{2,4})/i);
  if (m) {
    const end = m[2];
    const fy  = end.length <= 2 ? 2000 + parseInt(end, 10) : parseInt(end, 10);
    if (fy >= 2015 && fy <= 2040) return fy; // sanity check
  }
  return null; // caller must handle
}

// ── Fiscal-year month position (April = 1 … March = 12) ────────────────────
const FISCAL_MONTH_POS: Record<string, number> = {
  april: 1, may: 2, june: 3, july: 4,
  august: 5, september: 6, october: 7, november: 8,
  december: 9, january: 10, february: 11, march: 12,
};
const MONTH_ABBR_MAP: Record<string, string> = {
  april: "Apr", may: "May", june: "Jun", july: "Jul",
  august: "Aug", september: "Sep", october: "Oct", november: "Nov",
  december: "Dec", january: "Jan", february: "Feb", march: "Mar",
};

// ── Label normalizer for monthly-tracking rows ──────────────────────────────
const PL_LABEL_MAP: Array<[RegExp, string]> = [
  [/^total\s*revenue$/i,          "Turnover"],
  [/^net\s*profit$/i,             "PAT"],
  [/^profit\s*after\s*tax$/i,     "PAT"],
  [/^cost\s*of\s*goods/i,         "Cost of Goods Sold"],
  [/^ebitda$/i,                   "EBITDA"],
  [/^tax$/i,                      "Tax"],
  [/^total\s*expenditure$/i,      "Operating Expenses"],
  [/^total\s*expenses?$/i,        "Operating Expenses"],
  [/^depreciation/i,              "Depreciation"],
  [/^interest/i,                  "Interest Expense"],
  [/^gross\s*profit$/i,           "Gross Profit"],
  [/^profit\s*before\s*tax$/i,    "Profit Before Tax"],
  [/^ebit$/i,                     "EBIT"],
];

function normalizePLLabel(raw: string): string | null {
  const s = raw.trim();
  for (const [re, mapped] of PL_LABEL_MAP) {
    if (re.test(s)) return mapped;
  }
  if (PL_LABELS.includes(s)) return s;
  return null;
}

// ── Monthly-tracking parser: Month | April | May | … | Total ───────────────
async function parseMonthlyTrackingFormat(
  buf: ArrayBuffer, filename: string, existingPeriods: ProvPeriod[]
): Promise<ProvPeriod[]> {
  const XLSX = await import("xlsx");
  const wb   = XLSX.read(buf, { type: "array", raw: false, cellText: true });
  const detectedFY = detectFYFromFilename(filename);
  if (!detectedFY) {
    throw new Error(
      `Cannot detect fiscal year from filename "${filename}".\n` +
      `Rename the file to include "FY24-25", "FY2024-25", or "2024-25" and try again.`
    );
  }
  const fy      = detectedFY;
  const fyShort = String(fy).slice(2);
  const defaultUnit = existingPeriods[0]?.unit ?? "INR";

  // Merge: keep existing periods, overwrite same-label ones, add new ones
  const periods: Map<string, ProvPeriod> = new Map();
  for (const p of existingPeriods) periods.set(p.label, { ...p });

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false }) as string[][];

    const headerIdx = rows.findIndex(r => String(r[0] ?? "").trim().toLowerCase() === "month");
    if (headerIdx === -1) continue;

    const headerRow = rows[headerIdx].map(c => String(c ?? "").trim());

    type ColDef = { colIdx: number; label: string; isTotal: boolean; months: number };
    const cols: ColDef[] = [];
    for (let c = 1; c < headerRow.length; c++) {
      const h     = headerRow[c].trim();
      const hLow  = h.toLowerCase();
      if (!h) continue;
      if (hLow === "total") {
        cols.push({ colIdx: c, label: `FY${fy}`, isTotal: true, months: 12 });
      } else if (FISCAL_MONTH_POS[hLow] !== undefined) {
        const abbr = MONTH_ABBR_MAP[hLow] ?? h;
        cols.push({ colIdx: c, label: `${abbr} FY${fyShort}`, isTotal: false, months: 1 });
      }
    }
    if (cols.length === 0) continue;

    for (const col of cols) {
      if (!periods.has(col.label)) {
        periods.set(col.label, {
          id: crypto.randomUUID(),
          label: col.label,
          period_type: col.isTotal ? "annual" : "monthly",
          fiscal_year: fy,
          months_covered: col.months,
          unit: defaultUnit,
          pl: blank(PL_LABELS),
          bs: blank(BS_LABELS),
        });
      }
    }

    let section: "pl" | "bs" | "skip" = "skip";
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row      = rows[i];
      const rawLabel = String(row[0] ?? "").trim();
      if (!rawLabel) continue;

      const ll = rawLabel.toLowerCase();
      if ((ll.includes("profit") && ll.includes("loss")) || ll.includes("p&l")) { section = "pl"; continue; }
      if (ll.includes("balance sheet"))                                           { section = "bs"; continue; }
      if (ll.includes("cashflow") || ll.includes("cash flow"))                   { section = "skip"; continue; }
      if (section === "skip") continue;

      const mapped = section === "pl" ? normalizePLLabel(rawLabel) : null;
      if (!mapped) continue;

      for (const col of cols) {
        const p   = periods.get(col.label);
        if (!p) continue;
        const val = parseIndianNumber(row[col.colIdx]);
        if (val !== null) p[section] = setv(p[section], mapped, val);
      }
    }
  }

  return Array.from(periods.values());
}

// ── Main import dispatcher ──────────────────────────────────────────────────
async function importProvisionalExcel(file: File, existingPeriods: ProvPeriod[]): Promise<ProvPeriod[]> {
  const XLSX = await import("xlsx");
  const buf  = await file.arrayBuffer();
  const wb   = XLSX.read(buf, { type: "array", raw: false, cellText: true });

  // Detect monthly-tracking format (first cell of any row within first 20 rows = "month")
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false }) as string[][];
    if (rows.slice(0, 20).some(r => String(r[0] ?? "").trim().toLowerCase() === "month")) {
      return parseMonthlyTrackingFormat(buf, file.name, existingPeriods);
    }
  }

  // ── PARTICULARS / round-trip template format ────────────────────────────
  const periods: Map<string, ProvPeriod> = new Map();
  for (const p of existingPeriods) periods.set(p.label, { ...p });

  for (const sheetName of wb.SheetNames) {
    const ws    = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows  = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as string[][];
    if (rows.length < 2) continue;

    const isBS  = sheetName.toLowerCase().includes("balance") || sheetName.toLowerCase().includes("bs");
    const isPL  = sheetName.toLowerCase().includes("p&l") || sheetName.toLowerCase().includes("profit") || sheetName.toLowerCase().includes("pl");
    if (!isBS && !isPL) continue;
    const section: "pl" | "bs" = isBS ? "bs" : "pl";

    let headerIdx = rows.findIndex(r => String(r[0] ?? "").toUpperCase().includes("PARTICULARS"));
    if (headerIdx === -1) headerIdx = 0;
    const headerRow = rows[headerIdx].map(c => String(c).trim());
    const colLabels = headerRow.slice(1).filter(l => l && !l.startsWith("__"));

    const metaMonths: number[]   = [];
    const metaFY: number[]       = [];
    const metaType: PeriodType[] = [];
    const metaUnit: string[]     = [];

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const key = String(row[0] ?? "").trim();
      if (key === "__months_covered__") { metaMonths.push(...row.slice(1).filter((_, j) => j < colLabels.length).map(v => Number(v) || 3)); continue; }
      if (key === "__fiscal_year__")    { metaFY.push(...row.slice(1).filter((_, j) => j < colLabels.length).map(v => Number(v) || new Date().getFullYear())); continue; }
      if (key === "__period_type__")    { metaType.push(...row.slice(1).filter((_, j) => j < colLabels.length).map(v => (String(v) || "quarterly") as PeriodType)); continue; }
      if (key === "__unit__")           { metaUnit.push(...row.slice(1).filter((_, j) => j < colLabels.length).map(v => String(v) || "Lakhs")); continue; }
    }

    const fy = new Date().getFullYear();
    for (let c = 0; c < colLabels.length; c++) {
      const label = colLabels[c];
      if (!periods.has(label)) {
        periods.set(label, {
          id: crypto.randomUUID(), label,
          period_type: (metaType[c] ?? "quarterly") as PeriodType,
          fiscal_year: metaFY[c] ?? fy,
          months_covered: metaMonths[c] ?? 3,
          unit: metaUnit[c] ?? "Lakhs",
          pl: blank(PL_LABELS), bs: blank(BS_LABELS),
        });
      }
    }

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const lineLabel = String(row[0] ?? "").trim();
      if (!lineLabel || lineLabel.startsWith("__") || lineLabel === "---") continue;

      for (let c = 0; c < colLabels.length; c++) {
        const col = colLabels[c];
        const p   = periods.get(col);
        if (!p) continue;
        const raw = row[c + 1];
        const val = raw === "" || raw == null ? null : Number(raw);
        p[section] = setv(p[section], lineLabel, isNaN(val as number) ? null : val);
      }
    }
  }

  return Array.from(periods.values());
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADD PERIOD FORM
// ═══════════════════════════════════════════════════════════════════════════════

function AddPeriodForm({ onAdd, onCancel, existingPeriods }: {
  onAdd: (p: ProvPeriod) => void;
  onCancel: () => void;
  existingPeriods: ProvPeriod[];
}) {
  const curFY = new Date().getFullYear();
  const [type,   setType]   = useState<PeriodType>("quarterly");
  const [fy,     setFY]     = useState(curFY);
  const [months, setMonths] = useState(3);
  const [quarter, setQ]     = useState(1);
  const [half,    setH]     = useState(1);
  const [month,   setM]     = useState(1);
  const [unit,    setUnit]  = useState(existingPeriods[0]?.unit ?? "Lakhs");
  const [customLabel, setCL] = useState("");

  const autoLabel = suggestLabel(type, fy, months, { quarter, half, month });
  const label = customLabel.trim() || autoLabel;

  const mc = type === "monthly" ? 1 : type === "quarterly" ? 3 : type === "half_yearly" ? 6 : type === "nine_month" ? 9 : type === "annual" ? 12 : months;

  const handleAdd = () => {
    onAdd({
      id: crypto.randomUUID(), label,
      period_type: type, fiscal_year: fy, months_covered: mc, unit,
      pl: blank(PL_LABELS), bs: blank(BS_LABELS),
    });
  };

  return (
    <div className="border border-accent/40 bg-accent/5 p-3 space-y-3">
      <div className="text-[9px] text-accent tracking-widest font-bold">ADD PROVISIONAL PERIOD</div>
      <div className="grid grid-cols-4 gap-2">
        <div className="space-y-0.5">
          <label className="text-[9px] text-muted-foreground tracking-widest">PERIOD TYPE</label>
          <select value={type} onChange={e => { setType(e.target.value as PeriodType); setMonths(PERIOD_TYPE_META[e.target.value as PeriodType].defaultMonths); }}
            className="w-full bg-input border border-border px-2 py-1 text-xs focus:outline-none focus:border-primary">
            {Object.entries(PERIOD_TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        <div className="space-y-0.5">
          <label className="text-[9px] text-muted-foreground tracking-widest">FISCAL YEAR</label>
          <input type="number" value={fy} onChange={e => setFY(Number(e.target.value))}
            className="w-full bg-input border border-border px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary" />
        </div>

        {type === "quarterly" && (
          <div className="space-y-0.5">
            <label className="text-[9px] text-muted-foreground tracking-widest">QUARTER</label>
            <select value={quarter} onChange={e => setQ(Number(e.target.value))}
              className="w-full bg-input border border-border px-2 py-1 text-xs focus:outline-none focus:border-primary">
              {[1,2,3,4].map(q => <option key={q} value={q}>Q{q} ({["Apr–Jun","Jul–Sep","Oct–Dec","Jan–Mar"][q-1]})</option>)}
            </select>
          </div>
        )}
        {type === "half_yearly" && (
          <div className="space-y-0.5">
            <label className="text-[9px] text-muted-foreground tracking-widest">HALF</label>
            <select value={half} onChange={e => setH(Number(e.target.value))}
              className="w-full bg-input border border-border px-2 py-1 text-xs focus:outline-none focus:border-primary">
              <option value={1}>H1 (Apr–Sep)</option>
              <option value={2}>H2 (Oct–Mar)</option>
            </select>
          </div>
        )}
        {type === "monthly" && (
          <div className="space-y-0.5">
            <label className="text-[9px] text-muted-foreground tracking-widest">MONTH</label>
            <select value={month} onChange={e => setM(Number(e.target.value))}
              className="w-full bg-input border border-border px-2 py-1 text-xs focus:outline-none focus:border-primary">
              {MONTH_NAMES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
        )}
        {(type === "ytd" || type === "nine_month") && (
          <div className="space-y-0.5">
            <label className="text-[9px] text-muted-foreground tracking-widest">MONTHS COVERED</label>
            <input type="number" min={1} max={11} value={months} onChange={e => setMonths(Number(e.target.value))}
              className="w-full bg-input border border-border px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary" />
          </div>
        )}

        <div className="space-y-0.5">
          <label className="text-[9px] text-muted-foreground tracking-widest">UNIT</label>
          <select value={unit} onChange={e => setUnit(e.target.value)}
            className="w-full bg-input border border-border px-2 py-1 text-xs focus:outline-none focus:border-primary">
            {["Lakhs","Crores","INR","USD"].map(u => <option key={u}>{u}</option>)}
          </select>
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <div className="space-y-0.5 flex-1">
          <label className="text-[9px] text-muted-foreground tracking-widest">LABEL (auto-generated, editable)</label>
          <input type="text" value={customLabel || autoLabel}
            onChange={e => setCL(e.target.value === autoLabel ? "" : e.target.value)}
            className="w-full bg-input border border-border px-2 py-1 text-xs focus:outline-none focus:border-primary" />
        </div>
        <div className="space-y-0.5 text-center pt-4">
          <div className="text-[9px] text-muted-foreground tracking-widest">ANNUALIZED AT</div>
          <div className="text-sm font-bold text-accent tabular-nums">{mc}M → 12M</div>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={handleAdd} className="bg-primary text-primary-foreground text-[10px] tracking-widest px-4 py-1.5">[ADD PERIOD →]</button>
        <button onClick={onCancel} className="border border-border text-[10px] px-3 py-1.5 text-muted-foreground hover:text-foreground">CANCEL</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EDITABLE FINANCIAL TABLE
// ═══════════════════════════════════════════════════════════════════════════════

function FinTable({
  section, periods, labels, showAnnualized, auditedItems,
  onEdit,
}: {
  section: "pl" | "bs";
  periods: ProvPeriod[];
  labels: string[];
  showAnnualized: boolean;
  auditedItems: LineItem[] | null;
  onEdit: (periodId: string, section: "pl" | "bs", label: string, value: number | null) => void;
}) {
  const [editCell, setEditCell] = useState<{ id: string; label: string } | null>(null);
  const [editVal, setEditVal]   = useState("");

  const startEdit = (id: string, label: string, cur: number | null) => {
    setEditCell({ id, label }); setEditVal(cur != null ? String(cur) : "");
  };
  const commit = () => {
    if (!editCell) return;
    const v = editVal.trim() === "" ? null : parseFloat(editVal);
    onEdit(editCell.id, section, editCell.label, isNaN(v as number) ? null : v);
    setEditCell(null);
  };

  if (periods.length === 0) return <div className="text-[10px] text-muted-foreground">No periods added yet.</div>;

  // Use the latest partial-year period for annualization, not the annual summary
  const showAnn     = showAnnualized && periods.some(p => p.months_covered < 12);
  const latestPartP = [...periods].reverse().find(p => p.months_covered < 12);
  const latestP     = latestPartP ?? periods[periods.length - 1];

  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full min-w-max">
        <thead className="text-muted-foreground border-b border-border">
          <tr>
            <th className="text-left py-1 pr-4 min-w-[160px]">LINE ITEM</th>
            {auditedItems && <th className="text-right pr-3 text-muted-foreground/60 min-w-[90px]">AUDITED</th>}
            {periods.map(p => (
              <th key={p.id} className="text-right pr-2 min-w-[90px]">
                <div>{p.label}</div>
                <div className="text-[8px] font-normal text-muted-foreground/60">{p.unit} · {p.months_covered}M</div>
              </th>
            ))}
            {showAnn && (
              <th className="text-right pr-2 min-w-[90px] text-accent/80">
                <div>ANNUALIZED</div>
                <div className="text-[8px] font-normal text-muted-foreground/60">{latestP.label} × (12/{latestP.months_covered})</div>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {labels.map(label => {
            const auditedVal = auditedItems ? getv(auditedItems, label) : null;
            const latestVal  = getv(latestP?.[section] ?? [], label);
            const annVal     = showAnn && latestP ? annualize(latestVal, latestP.months_covered) : null;

            return (
              <tr key={label} className="border-b border-border/20 hover:bg-surface/20">
                <td className="py-1 pr-4 text-foreground/80">{label}</td>

                {auditedItems && (
                  <td className="text-right pr-3 tabular-nums text-muted-foreground/60">{fmtN(auditedVal)}</td>
                )}

                {periods.map(p => {
                  const val    = getv(p[section], label);
                  const isEdit = editCell?.id === p.id && editCell?.label === label;
                  return (
                    <td key={p.id} className="text-right pr-2 tabular-nums">
                      {isEdit ? (
                        <input autoFocus type="number" value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          onBlur={commit}
                          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditCell(null); }}
                          className="w-20 bg-input border border-primary px-1 py-0.5 text-right text-xs focus:outline-none font-mono" />
                      ) : (
                        <span
                          onClick={() => startEdit(p.id, label, val)}
                          className={`cursor-pointer hover:text-primary hover:underline hover:underline-offset-2 ${val != null ? "text-foreground" : "text-muted-foreground/30"}`}
                          title="Click to edit"
                        >
                          {val != null ? fmtN(val) : "—"}
                        </span>
                      )}
                    </td>
                  );
                })}

                {showAnn && (
                  <td className="text-right pr-2 tabular-nums text-accent/80 font-medium">
                    {fmtN(annVal)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function ProvisionalTab({
  cc, periods: initialPeriods, extracted, onSave,
}: {
  cc: CaseRow;
  periods: ProvPeriod[];
  extracted: ExtractedRow[];
  onSave: (periods: ProvPeriod[]) => Promise<void>;
}) {
  const [periods,    setPeriods]  = useState<ProvPeriod[]>(initialPeriods);
  const [adding,     setAdding]   = useState(false);
  const [saving,     setSaving]   = useState(false);
  const [saved,      setSaved]    = useState(false);
  const [importing,  setImp]      = useState(false);
  const [showAnn,    setShowAnn]  = useState(true);
  const [showBS,     setShowBS]   = useState(true);
  const [selectedFY, setSelectedFY] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Get last audited P&L + BS ──────────────────────────────────────────────
  const auditedPLRows = extracted.filter(r => r.statement_type === "profit_loss" && r.confirmed);
  const auditedBSRows = extracted.filter(r => r.statement_type === "balance_sheet" && r.confirmed);
  const lastAuditedFY = Math.max(0, ...auditedPLRows.map(r => r.fiscal_year));
  const auditedPL = lastAuditedFY
    ? (auditedPLRows.find(r => r.fiscal_year === lastAuditedFY)?.line_items as unknown as LineItem[] ?? null)
    : null;
  const auditedBS = lastAuditedFY
    ? (auditedBSRows.find(r => r.fiscal_year === lastAuditedFY)?.line_items as unknown as LineItem[] ?? null)
    : null;

  const sorted = [...periods].sort((a, b) => {
    if (a.fiscal_year !== b.fiscal_year) return a.fiscal_year - b.fiscal_year;
    return a.months_covered - b.months_covered;
  });

  // ── Per-FY grouping ────────────────────────────────────────────────────────
  const fyGroups = sorted.reduce<Record<number, ProvPeriod[]>>((acc, p) => {
    (acc[p.fiscal_year] ??= []).push(p);
    return acc;
  }, {});
  const fyList    = Object.keys(fyGroups).map(Number).sort();
  const activeFY  = (selectedFY && fyGroups[selectedFY]) ? selectedFY : (fyList[fyList.length - 1] ?? null);
  const viewPeriods = activeFY ? (fyGroups[activeFY] ?? []) : sorted;

  const latest = viewPeriods[viewPeriods.length - 1];

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleAdd = (p: ProvPeriod) => {
    setPeriods(prev => [...prev, p]);
    setAdding(false);
  };

  const handleEdit = (periodId: string, section: "pl" | "bs", label: string, value: number | null) => {
    setPeriods(prev => prev.map(p =>
      p.id !== periodId ? p : { ...p, [section]: setv(p[section], label, value) }
    ));
  };

  const handleRemove = (id: string) => {
    if (!window.confirm("Remove this period?")) return;
    setPeriods(prev => prev.filter(p => p.id !== id));
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(periods);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleImport = async (file: File) => {
    setImp(true);
    try {
      const next = await importProvisionalExcel(file, periods);
      setPeriods(next);
    } catch (e) {
      alert("Import failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setImp(false);
    }
  };

  const handleExport = () => exportProvisionalExcel(sorted, cc.case_code);

  // ── KPI source: prefer the annual summary period; fall back to latest partial ─
  const annualPeriod  = viewPeriods.find(p => p.months_covered >= 12);
  const latestPartial = [...viewPeriods].reverse().find(p => p.months_covered < 12);
  const kpiPeriod     = annualPeriod ?? latestPartial ?? latest;

  function annOrDirect(v: number | null, mc: number): number | null {
    if (v == null) return null;
    return mc >= 12 ? v : (v / mc) * 12;
  }

  const annTurnover = kpiPeriod ? annOrDirect(getv(kpiPeriod.pl, "Turnover"), kpiPeriod.months_covered) : null;
  const annEbitda   = kpiPeriod ? annOrDirect(getv(kpiPeriod.pl, "EBITDA"),   kpiPeriod.months_covered) : null;
  const annPat      = kpiPeriod ? annOrDirect(getv(kpiPeriod.pl, "PAT"),       kpiPeriod.months_covered) : null;
  const auditTurn   = auditedPL ? getv(auditedPL, "Turnover") : null;
  const auditPat    = auditedPL ? getv(auditedPL, "PAT") : null;

  const unit = viewPeriods[0]?.unit ?? extracted.find(r => r.unit)?.unit ?? "Lakhs";

  return (
    <div className="space-y-3">

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ""; }} />

        <button onClick={() => setAdding(a => !a)} disabled={adding}
          className="text-[10px] tracking-widest border border-accent/50 text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40">
          + ADD PERIOD
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={importing}
          className="text-[10px] tracking-widest border border-border text-muted-foreground px-3 py-1.5 hover:text-foreground hover:border-primary/50 disabled:opacity-50">
          {importing ? "IMPORTING…" : "⬆ IMPORT EXCEL"}
        </button>
        {sorted.length > 0 && (
          <button onClick={handleExport}
            className="text-[10px] tracking-widest border border-border text-muted-foreground px-3 py-1.5 hover:text-foreground hover:border-primary/50">
            ⬇ EXPORT EXCEL
          </button>
        )}
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer ml-1">
          <input type="checkbox" checked={showAnn} onChange={e => setShowAnn(e.target.checked)} className="accent-primary" />
          SHOW ANNUALIZED
        </label>

        {/* ── Year tabs ──────────────────────────────────────────────────────── */}
        {fyList.length > 0 && (
          <div className="flex items-center gap-1 ml-2 border-l border-border pl-2">
            <span className="text-[9px] text-muted-foreground/60 tracking-widest mr-1">FY</span>
            {fyList.map(fy => (
              <button key={fy} onClick={() => setSelectedFY(fy)}
                className={`text-[10px] tracking-widest px-2.5 py-1 border transition-colors ${
                  activeFY === fy
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}>
                {fy}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex gap-2 flex-wrap">
          {viewPeriods.map(p => (
            <button key={p.id} onClick={() => handleRemove(p.id)}
              className="text-[8px] border border-destructive/30 text-destructive/50 hover:text-destructive hover:border-destructive px-1.5 py-0.5 tracking-widest">
              ✕ {p.label}
            </button>
          ))}
        </div>
        <button onClick={handleSave} disabled={saving}
          className="text-[10px] tracking-widest bg-primary text-primary-foreground px-3 py-1.5 disabled:opacity-50">
          {saving ? "SAVING..." : saved ? "✓ SAVED" : "[SAVE →]"}
        </button>
      </div>

      <div className="text-[9px] text-muted-foreground/60 tracking-wider">
        ▸ Click any cell to edit · Import merges with existing data — import multiple years to compare side by side · Use ✕ buttons to remove individual periods
      </div>

      {/* ── Add period form ──────────────────────────────────────────────────── */}
      {adding && (
        <AddPeriodForm
          onAdd={handleAdd}
          onCancel={() => setAdding(false)}
          existingPeriods={sorted}
        />
      )}

      {/* ── KPI cards ────────────────────────────────────────────────────────── */}
      {sorted.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Panel title={kpiPeriod && kpiPeriod.months_covered >= 12 ? "ANNUAL TURNOVER" : "ANNUALIZED TURNOVER"} ticker={kpiPeriod?.label ?? ""}>
            <div className="text-2xl font-bold text-primary glow tabular-nums">{fmtN(annTurnover)}</div>
            <div className="terminal-label mt-1">{fmtUnit(unit)} · {kpiPeriod && kpiPeriod.months_covered >= 12 ? "Full Year" : "Projected 12M"}</div>
            {auditTurn && <div className={`text-[10px] mt-0.5 ${growthCls(annTurnover && auditTurn ? annTurnover - auditTurn : null)}`}>vs audited FY{lastAuditedFY}: {growthLabel(annTurnover, auditTurn)}</div>}
          </Panel>
          <Panel title={kpiPeriod && kpiPeriod.months_covered >= 12 ? "ANNUAL EBITDA" : "ANNUALIZED EBITDA"} ticker={kpiPeriod?.label ?? ""}>
            <div className="text-2xl font-bold text-warning glow tabular-nums">{fmtN(annEbitda)}</div>
            <div className="terminal-label mt-1">{fmtUnit(unit)}</div>
            {annTurnover && annEbitda ? <div className="text-[10px] mt-0.5 text-muted-foreground">Margin: {((annEbitda / annTurnover) * 100).toFixed(1)}%</div> : null}
          </Panel>
          <Panel title={kpiPeriod && kpiPeriod.months_covered >= 12 ? "ANNUAL PAT" : "ANNUALIZED PAT"} ticker={kpiPeriod?.label ?? ""}>
            <div className={`text-2xl font-bold glow tabular-nums ${(annPat ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>{fmtN(annPat)}</div>
            <div className="terminal-label mt-1">{fmtUnit(unit)}</div>
            {auditPat && <div className={`text-[10px] mt-0.5 ${growthCls(annPat && auditPat ? annPat - auditPat : null)}`}>vs audited: {growthLabel(annPat, auditPat)}</div>}
          </Panel>
          <Panel title="PERIODS LOADED" ticker="PROVISIONAL DATA">
            <div className="text-2xl font-bold text-primary glow">{sorted.length}</div>
            <div className="terminal-label mt-1">{sorted.map(p => p.label).join(" · ")}</div>
          </Panel>
        </div>
      )}

      {/* ── Year-over-year comparison (only when multiple FYs loaded) ──────────── */}
      {fyList.length >= 2 && (
        <Panel title="YEAR-OVER-YEAR COMPARISON" ticker="ANNUAL TOTALS">
          <table className="text-xs w-full">
            <thead className="text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-1 min-w-[140px]">METRIC</th>
                {fyList.map(fy => (
                  <th key={fy} className="text-right pr-3 min-w-[110px]">FY{fy}</th>
                ))}
                <th className="text-right pr-2 min-w-[80px]">YoY GROWTH</th>
              </tr>
            </thead>
            <tbody>
              {(["Turnover", "EBITDA", "PAT"] as const).map(label => {
                const vals = fyList.map(fy => {
                  const ann = fyGroups[fy]?.find(p => p.months_covered >= 12);
                  return ann ? getv(ann.pl, label) : null;
                });
                const prevVal = vals[vals.length - 2];
                const curVal  = vals[vals.length - 1];
                const gl      = growthLabel(curVal, prevVal);
                return (
                  <tr key={label} className="border-b border-border/20">
                    <td className="py-1.5 font-medium">{label}</td>
                    {vals.map((v, i) => (
                      <td key={i} className="text-right pr-3 tabular-nums">{fmtN(v)}</td>
                    ))}
                    <td className={`text-right pr-2 tabular-nums font-bold ${growthCls(curVal != null && prevVal != null ? curVal - prevVal : null)}`}>{gl}</td>
                  </tr>
                );
              })}
              {(["EBITDA", "PAT"] as const).map(label => {
                // Margin %
                const margins = fyList.map(fy => {
                  const ann = fyGroups[fy]?.find(p => p.months_covered >= 12);
                  if (!ann) return null;
                  const v  = getv(ann.pl, label);
                  const t  = getv(ann.pl, "Turnover");
                  return v != null && t ? (v / t) * 100 : null;
                });
                return (
                  <tr key={label + "_pct"} className="border-b border-border/20 text-muted-foreground">
                    <td className="py-1 pl-2 text-[10px]">{label} Margin %</td>
                    {margins.map((m, i) => (
                      <td key={i} className="text-right pr-3 tabular-nums text-[10px]">{m != null ? m.toFixed(1) + "%" : "—"}</td>
                    ))}
                    <td />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}

      {/* ── P&L Table ────────────────────────────────────────────────────────── */}
      {viewPeriods.length > 0 ? (
        <Panel title={`PROVISIONAL P&L${activeFY ? ` · FY${activeFY}` : ""}`} ticker={`${fmtUnit(unit)} · CLICK CELL TO EDIT`}>
          <FinTable
            section="pl" periods={viewPeriods} labels={PL_LABELS}
            showAnnualized={showAnn} auditedItems={auditedPL}
            onEdit={handleEdit}
          />
          {showAnn && viewPeriods.some(p => p.months_covered < 12) && (
            <div className="text-[9px] text-muted-foreground mt-2 tracking-wider border-t border-border/20 pt-1.5">
              ▸ ANNUALIZED = latest monthly period × (12 ÷ months covered) · Not a forecast — assumes uniform run-rate
            </div>
          )}
        </Panel>
      ) : (
        <Panel title="NO PROVISIONAL DATA" ticker="MONTHLY / QUARTERLY">
          <div className="text-muted-foreground text-xs space-y-1 leading-relaxed">
            <p>Add provisional periods (monthly, quarterly, half-year, YTD) to track in-period performance.</p>
            <p>Import from Excel — filename must include "FY24-25" or similar so the fiscal year is auto-detected.</p>
            <p>Import multiple years to compare them side by side using the year tabs above.</p>
          </div>
        </Panel>
      )}

      {/* ── Balance Sheet Table ───────────────────────────────────────────────── */}
      {viewPeriods.length > 0 && (
        <Panel
          title={`PROVISIONAL BALANCE SHEET${activeFY ? ` · FY${activeFY}` : ""}`}
          ticker="CLICK CELL TO EDIT"
          actions={
            <button onClick={() => setShowBS(s => !s)} className="text-[9px] border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground tracking-widest">
              {showBS ? "COLLAPSE" : "EXPAND"}
            </button>
          }
        >
          {showBS && (
            <FinTable
              section="bs" periods={viewPeriods} labels={BS_LABELS}
              showAnnualized={false} auditedItems={auditedBS}
              onEdit={handleEdit}
            />
          )}
        </Panel>
      )}

      {/* ── Period-over-period growth ─────────────────────────────────────────── */}
      {sorted.length >= 2 && (() => {
        // Only compare like-for-like periods (monthly vs monthly, etc.)
        // Exclude the annual summary from the sequential MoM chain
        const growthPeriods = sorted.filter(p => p.months_covered < 12);
        if (growthPeriods.length < 2) return null;
        return (
          <Panel title="MONTH-OVER-MONTH GROWTH" ticker="MoM TREND">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-max">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-1 min-w-[90px]">METRIC</th>
                    {growthPeriods.map((p, i) => i > 0 && (
                      <th key={p.id} className="text-right pr-2 min-w-[110px] text-[9px]">
                        {growthPeriods[i-1].label} → {p.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Turnover", key: "pl" as const, lineLabel: "Turnover" },
                    { label: "EBITDA",   key: "pl" as const, lineLabel: "EBITDA" },
                    { label: "PAT",      key: "pl" as const, lineLabel: "PAT" },
                  ].map(({ label, key, lineLabel }) => (
                    <tr key={label} className="border-b border-border/20">
                      <td className="py-1.5">{label}</td>
                      {growthPeriods.map((p, i) => {
                        if (i === 0) return null;
                        const curr = getv(p[key], lineLabel);
                        const prev = getv(growthPeriods[i-1][key], lineLabel);
                        const gl   = growthLabel(curr, prev);
                        return (
                          <td key={p.id} className={`text-right pr-2 tabular-nums font-medium ${growthCls(curr != null && prev != null && prev !== 0 ? curr - prev : null)}`}>
                            {gl}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })()}
    </div>
  );
}
