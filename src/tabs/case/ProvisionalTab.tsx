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

import { useState, useRef, useEffect } from "react";
import { Panel } from "@/components/terminal/Panel";
import type { CaseRow, ExtractedRow, LineItem } from "@/features/case/types";
import { unitAbbr, fmtUnit } from "@/features/case/utils";
import { buildProvisionalTemplate, downloadBuffer } from "@/lib/excel-templates";

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
  cf: LineItem[];
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
  "Share Capital", "Reserves & Surplus", "Net Worth",
  "Long Term Borrowings", "Short Term Borrowings", "Total Debt",
  "Trade Payables", "Other Current Liabilities", "Current Liabilities", "Total Liabilities",
  "Fixed Assets (Net)", "Inventory", "Trade Receivables",
  "Cash & Bank", "Other Current Assets", "Current Assets", "Total Assets",
];
const CF_LABELS = [
  "Cash from Operations",
  "Cash from Investing",
  "Cash from Financing",
  "Net Change in Cash",
  "Opening Cash",
  "Closing Cash",
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

function toL(v: number | null, unit: string): number | null {
  if (v == null) return null;
  const u = unit.toLowerCase();
  if (u === "crores" || u === "crore") return v * 100;
  if (u === "inr" || u === "rupees" || u === "rs") return v / 1e5;
  if (u === "thousands") return v / 100;
  return v;
}
function fromL(v: number | null, unit: string): number | null {
  if (v == null) return null;
  const u = unit.toLowerCase();
  if (u === "crores" || u === "crore") return v / 100;
  if (u === "inr" || u === "rupees" || u === "rs") return v * 1e5;
  if (u === "thousands") return v * 100;
  return v;
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

  for (const [section, sectionLabels] of [["P&L", PL_LABELS], ["Balance Sheet", BS_LABELS], ["Cash Flow", CF_LABELS]] as const) {
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
      const key: "pl" | "bs" | "cf" = section === "P&L" ? "pl" : section === "Balance Sheet" ? "bs" : "cf";
      rows.push([label, ...periods.map(p => getv(p[key], label) ?? "")]);
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

// ── Label normalizers ───────────────────────────────────────────────────────
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

const CF_LABEL_MAP: Array<[RegExp, string]> = [
  [/net\s*cash.*(from|used).*operat/i,  "Cash from Operations"],
  [/net\s*cash.*(from|used).*invest/i,  "Cash from Investing"],
  [/net\s*cash.*(from|used).*financ/i,  "Cash from Financing"],
  [/net\s*(increase|decrease|change).*cash/i, "Net Change in Cash"],
  [/cash.*end.*previous|opening.*cash|cash.*beginning.*period/i, "Opening Cash"],
  [/cash.*end.*year|closing.*cash/i,    "Closing Cash"],
];

function normalizeCFLabel(raw: string): string | null {
  const s = raw.trim();
  for (const [re, mapped] of CF_LABEL_MAP) {
    if (re.test(s)) return mapped;
  }
  if (CF_LABELS.includes(s)) return s;
  return null;
}

const BS_LABEL_MAP: Array<[RegExp, string]> = [
  [/share\s*capital/i,                         "Share Capital"],
  [/reserves?\s*(and|&)\s*surplus/i,           "Reserves & Surplus"],
  [/net\s*worth|shareholders?\s*equity/i,       "Net Worth"],
  [/long.?term\s*borrowings?/i,                "Long Term Borrowings"],
  [/short.?term\s*borrowings?/i,               "Short Term Borrowings"],
  [/total\s*debt/i,                            "Total Debt"],
  [/trade\s*payables?/i,                       "Trade Payables"],
  [/other\s*current\s*liabilit/i,              "Other Current Liabilities"],
  [/\bcurrent\s*liabilit/i,                    "Current Liabilities"],
  [/total\s*liabilit/i,                        "Total Liabilities"],
  [/property.*plant|fixed\s*assets?|tangible/i,"Fixed Assets (Net)"],
  [/inventori|stock/i,                         "Inventory"],
  [/trade\s*receivables?|debtors?/i,           "Trade Receivables"],
  [/cash\s*(and|&)\s*(bank|cash\s*equiv)/i,    "Cash & Bank"],
  [/other\s*current\s*assets?/i,               "Other Current Assets"],
  [/\bcurrent\s*assets?/i,                     "Current Assets"],
  [/total\s*assets?/i,                         "Total Assets"],
];

function classifyLabel(raw: string): { section: "pl" | "bs" | "cf"; std: string } | null {
  const s = raw.trim();
  const pl = normalizePLLabel(s);
  if (pl) return { section: "pl", std: pl };
  const cf = normalizeCFLabel(s);
  if (cf) return { section: "cf", std: cf };
  for (const [re, std] of BS_LABEL_MAP) if (re.test(s)) return { section: "bs", std };
  if (BS_LABELS.includes(s)) return { section: "bs", std: s };
  return null;
}

// ── Simple annual parser: columns = fiscal years, rows = any label ──────────
async function parseSimpleAnnualExcel(
  file: File,
  existingPeriods: ProvPeriod[],
): Promise<ProvPeriod[]> {
  const XLSX = await import("xlsx");
  const buf  = await file.arrayBuffer();
  const wb   = XLSX.read(buf, { type: "array", raw: false, cellText: true });

  let unit = "Lakhs";
  const periodMap = new Map(existingPeriods.map(p => [p.label, { ...p }]));
  let parsedAny = false;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false }) as string[][];
    if (rows.length < 2) continue;

    // Detect unit from first 8 rows
    outer: for (const row of rows.slice(0, 8)) {
      for (const c of row) {
        if (/amount.*in.*(rs|inr|lakh|crore|thousand)/i.test(String(c))) {
          const s = String(c).toLowerCase();
          if (/crore/i.test(s)) unit = "Crores";
          else if (/thousand/i.test(s)) unit = "Thousands";
          break outer;
        }
      }
    }

    // Find header row: first row with ≥1 FY-style column header
    let headerIdx = -1;
    const fyColumns: { col: number; fy: number }[] = [];
    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      const row = rows[i];
      const found: typeof fyColumns = [];
      for (let c = 1; c < row.length; c++) {
        const cell = String(row[c]).trim();
        const m = cell.match(/(?:fy\s*)?(\d{2,4})(?:\s*[-–]\s*\d{2,4})?/i);
        if (m) {
          const yr = parseInt(m[1]);
          const fy = yr < 100 ? 2000 + yr : yr;
          if (fy >= 2015 && fy <= 2045) found.push({ col: c, fy });
        }
      }
      if (found.length > 0) { headerIdx = i; fyColumns.push(...found); break; }
    }
    if (headerIdx === -1 || fyColumns.length === 0) continue;

    // Ensure a ProvPeriod exists for each detected FY
    for (const { fy } of fyColumns) {
      const label = `FY${fy}`;
      if (!periodMap.has(label)) {
        periodMap.set(label, {
          id: crypto.randomUUID(), label, period_type: "annual",
          fiscal_year: fy, months_covered: 12, unit,
          pl: blank(PL_LABELS), bs: blank(BS_LABELS), cf: blank(CF_LABELS),
        });
      }
    }

    // Parse data rows
    let currentSection: "pl" | "bs" | "cf" | null = null;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const rawLabel = String(row[0] ?? "").trim();
      if (!rawLabel || /^(---|\s*)$/.test(rawLabel)) continue;

      // Section header detection
      const ll = rawLabel.toLowerCase();
      if (/profit.*loss|p\s*[&]\s*l|income\s*statement/i.test(ll)) { currentSection = "pl"; continue; }
      if (/balance\s*sheet/i.test(ll)) { currentSection = "bs"; continue; }
      if (/cash\s*flow/i.test(ll)) { currentSection = "cf"; continue; }

      const classified = classifyLabel(rawLabel);
      const section = classified?.section ?? currentSection ?? "bs";
      const std = classified?.std ?? rawLabel;

      for (const { col, fy } of fyColumns) {
        const val = parseIndianNumber(row[col]);
        if (val == null) continue;
        const p = periodMap.get(`FY${fy}`);
        if (!p) continue;
        const cur = getv(p[section], std) ?? 0;
        p[section] = setv(p[section], std, cur + val);
      }
    }
    parsedAny = true;
  }

  if (!parsedAny) throw new Error("No fiscal year columns found. Make sure column headers include a year (e.g. FY24, FY2024, 2024).");

  // Derive computed fields for each period
  for (const p of periodMap.values()) {
    const gv = (sec: "pl" | "bs", lbl: string) => getv(p[sec], lbl) ?? 0;
    const gp     = gv("pl", "Turnover") - gv("pl", "Cost of Goods Sold");
    const ebitda = gp - gv("pl", "Operating Expenses");
    const ebit   = ebitda - gv("pl", "Depreciation");
    const pbt    = ebit - gv("pl", "Interest Expense");
    const pat    = pbt - gv("pl", "Tax");
    if (gv("pl", "Gross Profit")      === 0 && gp     !== 0) p.pl = setv(p.pl, "Gross Profit",      gp);
    if (gv("pl", "EBITDA")            === 0 && ebitda !== 0) p.pl = setv(p.pl, "EBITDA",            ebitda);
    if (gv("pl", "EBIT")              === 0 && ebit   !== 0) p.pl = setv(p.pl, "EBIT",              ebit);
    if (gv("pl", "Profit Before Tax") === 0 && pbt    !== 0) p.pl = setv(p.pl, "Profit Before Tax", pbt);
    if (gv("pl", "PAT")               === 0 && pat    !== 0) p.pl = setv(p.pl, "PAT",               pat);
    const nw = gv("bs", "Share Capital") + gv("bs", "Reserves & Surplus");
    const td = gv("bs", "Long Term Borrowings") + gv("bs", "Short Term Borrowings");
    const cl = gv("bs", "Trade Payables") + gv("bs", "Other Current Liabilities") + gv("bs", "Short Term Borrowings");
    const ca = gv("bs", "Inventory") + gv("bs", "Trade Receivables") + gv("bs", "Cash & Bank") + gv("bs", "Other Current Assets");
    const ta = gv("bs", "Fixed Assets (Net)") + ca;
    if (gv("bs", "Net Worth")           === 0 && nw !== 0) p.bs = setv(p.bs, "Net Worth",           nw);
    if (gv("bs", "Total Debt")          === 0 && td !== 0) p.bs = setv(p.bs, "Total Debt",          td);
    if (gv("bs", "Current Liabilities") === 0 && cl !== 0) p.bs = setv(p.bs, "Current Liabilities", cl);
    if (gv("bs", "Current Assets")      === 0 && ca !== 0) p.bs = setv(p.bs, "Current Assets",      ca);
    if (gv("bs", "Total Assets")        === 0 && ta !== 0) p.bs = setv(p.bs, "Total Assets",        ta);
    if (gv("bs", "Total Liabilities")   === 0 && ta !== 0) p.bs = setv(p.bs, "Total Liabilities",   ta);
  }

  return Array.from(periodMap.values());
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
          cf: blank(CF_LABELS),
        });
      }
    }

    let section: "pl" | "bs" | "cf" | "skip" = "skip";
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row      = rows[i];
      const rawLabel = String(row[0] ?? "").trim();
      if (!rawLabel) continue;

      const ll = rawLabel.toLowerCase();
      if ((ll.includes("profit") && ll.includes("loss")) || ll.includes("p&l")) { section = "pl"; continue; }
      if (ll.includes("balance sheet"))                                           { section = "bs"; continue; }
      if (ll.includes("cashflow") || ll.includes("cash flow"))                   { section = "cf"; continue; }
      if (section === "skip") continue;

      let mapped: string | null = null;
      if (section === "pl") mapped = normalizePLLabel(rawLabel);
      else if (section === "cf") mapped = normalizeCFLabel(rawLabel);
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

// ── Schedule III / period-end two-column format (BS + P&L + CF in separate sheets) ─
function parsePeriodHeader(header: string): { fiscal_year: number; months_covered: number; label: string; period_type: PeriodType } | null {
  const MONTHS: Record<string, number> = {
    january:1,february:2,march:3,april:4,may:5,june:6,
    july:7,august:8,september:9,october:10,november:11,december:12,
    jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
  };

  // Detect qualifier prefix like "Audited", "Provisional", "Projected"
  const qualM = String(header).match(/^(audited|provisional|projected|unaudited)\b\s*/i);
  const qualifier = qualM ? qualM[1].charAt(0).toUpperCase() + qualM[1].slice(1).toLowerCase() : null;
  const h = qualM ? header.slice(qualM[0].length) : header;

  const makePeriod = (monthNum: number, year: number) => {
    let fiscal_year: number, months_covered: number;
    if (monthNum >= 4) { fiscal_year = year + 1; months_covered = monthNum - 3; }
    else               { fiscal_year = year;     months_covered = monthNum + 9; }
    const fyShort = String(fiscal_year).slice(2);
    const ABBR = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const base = months_covered >= 12 ? `FY${fiscal_year}` : `${ABBR[monthNum]} FY${fyShort}`;
    const label = qualifier ? `${base} (${qualifier})` : base;
    const period_type: PeriodType =
      months_covered >= 12 ? "annual" : months_covered === 9 ? "nine_month" :
      months_covered === 6 ? "half_yearly" : months_covered === 3 ? "quarterly" :
      months_covered === 1 ? "monthly" : "ytd";
    return { fiscal_year, months_covered, label, period_type };
  };

  // Format 1: "31st March, 2024" or "31 March 2024"
  const m1 = h.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)[,.]?\s*(\d{4})/i);
  if (m1) {
    const monthNum = MONTHS[m1[2].toLowerCase()];
    const year = parseInt(m1[3]);
    if (monthNum && year) return makePeriod(monthNum, year);
  }

  // Format 2: "31/03/2024" DD/MM/YYYY (Indian date format)
  const m2 = h.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m2) {
    const day = parseInt(m2[1]), month = parseInt(m2[2]), year = parseInt(m2[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return makePeriod(month, year);
  }

  return null;
}

async function parseSchIIIFormat(buf: ArrayBuffer, existingPeriods: ProvPeriod[]): Promise<ProvPeriod[]> {
  const XLSX = await import("xlsx");
  const wb   = XLSX.read(buf, { type: "array", raw: false, cellText: false });

  const findSheet = (...patterns: RegExp[]) =>
    wb.SheetNames.find(n => patterns.some(p => p.test(n.trim())));

  const bsSheetName = findSheet(/^bs$/i, /balance\s*sheet/i);
  const plSheetName = findSheet(/^p\s*[&]\s*l$/i, /profit.*loss/i, /income.*statement/i);
  const cfSheetName = findSheet(/cash\s*flow/i, /cashflow/i);

  // Detect unit from any sheet header
  let unit = "INR";
  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn]; if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as string[][];
    const found = rows.slice(0, 8).flatMap(r => r).find(c => /amount\s*in\s*(rs|lakh|crore)/i.test(String(c)));
    if (found) {
      const s = String(found).toLowerCase();
      if (/lakh/i.test(s)) unit = "Lakhs";
      else if (/crore/i.test(s)) unit = "Crores";
      break;
    }
  }
  const defaultUnit = existingPeriods[0]?.unit ?? unit;

  // Shared helper: find header row (has date strings) and return { labelCol, dateCols }
  type DateCol = { col: number; info: ReturnType<typeof parsePeriodHeader> };
  function findDateCols(rows: string[][]): { labelCol: number; dateCols: DateCol[] } | null {
    for (const row of rows.slice(0, 12)) {
      const dateCols: DateCol[] = [];
      for (let i = 0; i < row.length; i++) {
        const cell = String(row[i]).trim();
        // Skip cells longer than 35 chars — real date headers are ~18 chars;
        // title sentences ("Balance Sheet as at 31st January, 2026") are 40+ chars
        if (cell.length > 35) continue;
        const info = parsePeriodHeader(cell);
        if (info) dateCols.push({ col: i, info });
      }
      if (dateCols.length >= 1) {
        let labelCol = 0;
        for (let i = 0; i < (dateCols[0]?.col ?? 1); i++) {
          if (/particulars|description|items?/i.test(String(row[i]))) { labelCol = i; break; }
        }
        return { labelCol, dateCols };
      }
    }
    return null;
  }

  const periods: Map<string, ProvPeriod> = new Map();
  for (const p of existingPeriods) periods.set(p.label, { ...p });

  const ensurePeriod = (info: NonNullable<ReturnType<typeof parsePeriodHeader>>) => {
    if (!periods.has(info.label)) {
      periods.set(info.label, {
        id: crypto.randomUUID(), label: info.label,
        period_type: info.period_type, fiscal_year: info.fiscal_year,
        months_covered: info.months_covered, unit: defaultUnit,
        pl: blank(PL_LABELS), bs: blank(BS_LABELS), cf: blank(CF_LABELS),
      });
    }
  };

  // P&L mapping (accumulate multi-row items like Employee + Admin = Operating Expenses)
  const SCH3_PL: Array<[RegExp, string]> = [
    [/revenue\s*from\s*operations?/i,          "Turnover"],
    [/cost\s*of\s*material\s*consumed/i,       "Cost of Goods Sold"],
    [/cost\s*of\s*goods\s*sold/i,              "Cost of Goods Sold"],
    [/purchases?\s*of\s*stock/i,               "Cost of Goods Sold"],
    [/employee\s*benefits?/i,                  "Operating Expenses"],
    [/staff\s*(cost|expense)/i,                "Operating Expenses"],
    [/administrative\s*expenses?/i,            "Operating Expenses"],
    [/other\s*expenses?/i,                     "Operating Expenses"],
    [/selling\s*(and|&)\s*distribution/i,      "Operating Expenses"],
    [/financial\s*cost|finance\s*cost/i,       "Interest Expense"],
    [/depreciation\s*(and|&)\s*amortis/i,      "Depreciation"],
    [/depreciation/i,                          "Depreciation"],
    [/profit.*before\s*tax/i,                  "Profit Before Tax"],
    [/\bcurrent\s*tax\b/i,                     "Tax"],
    [/profit.*(?:for|after).*(?:tax|year)/i,   "PAT"],
  ];

  // BS mapping
  const SCH3_BS: Array<[RegExp, string]> = [
    [/share\s*capital/i,                       "Share Capital"],
    [/reserves?\s*(?:and|&)\s*surplus/i,       "Reserves & Surplus"],
    [/long.?term\s*borrowings?/i,              "Long Term Borrowings"],
    [/other\s*long.?term\s*liabilit/i,         "Long Term Borrowings"],
    [/short.?term\s*borrowings?/i,             "Short Term Borrowings"],
    [/trade\s*payables?/i,                     "Trade Payables"],
    [/short.?term\s*provisions?/i,             "Other Current Liabilities"],
    [/other\s*current\s*liabilit/i,            "Other Current Liabilities"],
    [/property.*plant|tangible\s*assets?/i,   "Fixed Assets (Net)"],
    [/intangible\s*assets?/i,                  "Fixed Assets (Net)"],
    [/capital\s*work.*progress/i,              "Fixed Assets (Net)"],
    [/inventori|stock.in.trade/i,              "Inventory"],
    [/trade\s*receivables?/i,                  "Trade Receivables"],
    [/cash\s*(and|&)\s*cash\s*equiv/i,         "Cash & Bank"],
    [/other\s*current\s*assets?/i,             "Other Current Assets"],
    [/long.?term\s*loans?\s*(and|&)\s*advances?/i, "Other Current Assets"],
  ];

  // CF mapping
  const SCH3_CF: Array<[RegExp, string]> = [
    [/net\s*cash.*(from|used\s*in).*operat/i, "Cash from Operations"],
    [/net\s*cash.*(from|used\s*in).*invest/i, "Cash from Investing"],
    [/net\s*cash.*(from|used\s*in).*financ/i, "Cash from Financing"],
    [/net\s*(increase|decrease|change).*cash/i, "Net Change in Cash"],
    [/cash.*end.*previous|opening.*cash|cash.*begin/i, "Opening Cash"],
    [/cash.*end.*year|closing.*cash/i,        "Closing Cash"],
  ];

  const mapLabel = (map: Array<[RegExp, string]>, raw: string): string | null => {
    const s = raw.replace(/^\s*\([a-z0-9ivx]+\)\s*/i, "").trim(); // strip "(a)", "(i)", etc.
    for (const [re, std] of map) if (re.test(s)) return std;
    return null;
  };

  const accumulate = (p: ProvPeriod, section: "pl" | "bs" | "cf", std: string, val: number) => {
    const cur = getv(p[section], std) ?? 0;
    p[section] = setv(p[section], std, cur + val);
  };

  // Parse each financial sheet
  const sheetDefs: Array<{ name: string | undefined; map: Array<[RegExp, string]>; section: "pl" | "bs" | "cf"; labelColOffset?: number }> = [
    { name: plSheetName, map: SCH3_PL, section: "pl" },
    { name: bsSheetName, map: SCH3_BS, section: "bs" },
    { name: cfSheetName, map: SCH3_CF, section: "cf" },
  ];

  for (const { name, map, section } of sheetDefs) {
    if (!name) continue;
    const ws = wb.Sheets[name]; if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false }) as string[][];

    const found = findDateCols(rows);
    if (!found || found.dateCols.length === 0) continue;
    const { labelCol, dateCols } = found;

    for (const { info } of dateCols) if (info) ensurePeriod(info);

    // Skip non-data rows (header rows, subtotal rows that say "Total" alone, zero rows)
    const skipPattern = /^(total|sub.?total|less|add|particulars|note|items?)$/i;

    for (const row of rows) {
      // label is at labelCol; for CF, col 0 may hold a section letter (A–F) — use col 1 instead
      const lbl0 = String(row[labelCol] ?? "").trim();
      const rawLabel = (!lbl0 || (section === "cf" && /^[A-F]$/.test(lbl0)))
        ? (section === "cf" ? String(row[1] ?? "").trim() : "")
        : lbl0;
      if (!rawLabel || skipPattern.test(rawLabel)) continue;

      const std = mapLabel(map, rawLabel);
      if (!std) continue;

      for (const { col, info } of dateCols) {
        if (!info) continue;
        const p = periods.get(info.label);
        if (!p) continue;
        const val = parseIndianNumber(row[col]);
        if (val !== null && val !== 0) accumulate(p, section, std, val);
      }
    }
  }

  // Post-process: derive computed fields for each period
  for (const p of periods.values()) {
    const gv = (sec: "pl" | "bs", lbl: string) => getv(p[sec], lbl) ?? 0;

    // P&L derived
    const gp    = gv("pl", "Turnover") - gv("pl", "Cost of Goods Sold");
    const ebitda = gp - gv("pl", "Operating Expenses");
    const ebit   = ebitda - gv("pl", "Depreciation");
    if (gv("pl", "Gross Profit") === 0 && gp !== 0)    p.pl = setv(p.pl, "Gross Profit",    gp);
    if (gv("pl", "EBITDA")       === 0 && ebitda !== 0) p.pl = setv(p.pl, "EBITDA",          ebitda);
    if (gv("pl", "EBIT")         === 0 && ebit !== 0)   p.pl = setv(p.pl, "EBIT",            ebit);

    // BS derived
    const nw    = gv("bs", "Share Capital") + gv("bs", "Reserves & Surplus");
    const td    = gv("bs", "Long Term Borrowings") + gv("bs", "Short Term Borrowings");
    const cl    = gv("bs", "Trade Payables") + gv("bs", "Other Current Liabilities") + gv("bs", "Short Term Borrowings");
    const ca    = gv("bs", "Inventory") + gv("bs", "Trade Receivables") + gv("bs", "Cash & Bank") + gv("bs", "Other Current Assets");
    const fa    = gv("bs", "Fixed Assets (Net)");
    const ta    = fa + ca;
    if (gv("bs", "Net Worth")          === 0 && nw  !== 0) p.bs = setv(p.bs, "Net Worth",          nw);
    if (gv("bs", "Total Debt")         === 0 && td  !== 0) p.bs = setv(p.bs, "Total Debt",         td);
    if (gv("bs", "Current Liabilities") === 0 && cl !== 0) p.bs = setv(p.bs, "Current Liabilities", cl);
    if (gv("bs", "Current Assets")     === 0 && ca  !== 0) p.bs = setv(p.bs, "Current Assets",     ca);
    if (gv("bs", "Total Assets")       === 0 && ta  !== 0) p.bs = setv(p.bs, "Total Assets",       ta);
    if (gv("bs", "Total Liabilities")  === 0 && ta  !== 0) p.bs = setv(p.bs, "Total Liabilities",  ta);

    // CF: Net Change, Opening → Closing
    const cfOps  = gv("cf", "Cash from Operations");
    const cfInv  = gv("cf", "Cash from Investing");
    const cfFin  = gv("cf", "Cash from Financing");
    const netChg = cfOps + cfInv + cfFin;
    if (gv("cf", "Net Change in Cash") === 0 && netChg !== 0) p.cf = setv(p.cf, "Net Change in Cash", netChg);
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

  // Detect Sch III format: requires actual date-style column headers like "31st March, 2024"
  // (sheet name alone is not enough — our own template also has "Balance Sheet" / "P&L" sheets)
  const hasDateHeader = wb.SheetNames.some(sn => {
    const ws = wb.Sheets[sn]; if (!ws) return false;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as string[][];
    return rows.slice(0, 12).some(r => r.some(c => {
      const s = String(c);
      return /\d+\s*(?:st|nd|rd|th)?\s+[a-z]+\s+\d{4}/i.test(s) ||
             /\b(?:audited|provisional|projected|unaudited)\s+\d{1,2}\/\d{1,2}\/\d{4}\b/i.test(s) ||
             /\b\d{1,2}\/\d{1,2}\/\d{4}\b/.test(s);
    }));
  });
  if (hasDateHeader) {
    return parseSchIIIFormat(buf, existingPeriods);
  }

  // ── PARTICULARS / round-trip template format ────────────────────────────
  const periods: Map<string, ProvPeriod> = new Map();
  for (const p of existingPeriods) periods.set(p.label, { ...p });

  for (const sheetName of wb.SheetNames) {
    const ws    = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows  = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as string[][];
    if (rows.length < 2) continue;

    if (/claude\s*instruction/i.test(sheetName)) continue;
    const isBS  = sheetName.toLowerCase().includes("balance") || sheetName.toLowerCase() === "bs";
    const isPL  = sheetName.toLowerCase().includes("p&l") || sheetName.toLowerCase().includes("profit") || /^pl$/i.test(sheetName.trim());
    const isCF  = sheetName.toLowerCase().includes("cash");
    // "auto" = generic sheet — classify each row by label
    const section: "pl" | "bs" | "cf" | "auto" = isBS ? "bs" : isCF ? "cf" : isPL ? "pl" : "auto";

    let headerIdx = rows.findIndex(r => String(r[0] ?? "").toUpperCase().includes("PARTICULARS"));
    if (headerIdx === -1) headerIdx = 0;
    const headerRow = rows[headerIdx].map(c => String(c).trim());
    // Exclude meta rows, empty headers, and the aliases reference column
    const colLabels = headerRow.slice(1).filter(l =>
      l && !l.startsWith("__") && !/^aliases?\b/i.test(l) && !/reference only/i.test(l) && !/also known as/i.test(l)
    );

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

    const curFY = new Date().getFullYear();
    // colKey[c] = the periods-map key to write data for column c (deduplicates same FY+months)
    const colKey: string[] = [];
    for (let c = 0; c < colLabels.length; c++) {
      const label = colLabels[c];
      if (periods.has(label)) { colKey.push(label); continue; }
      // Detect FY from label like "FY2024 (Audited)", "FY2026 (Provisional)", "FY25", "2024-2025"
      const fyMatch = label.match(/\b(20\d{2})\b/);
      const detectedFY = fyMatch ? parseInt(fyMatch[1]) : (metaFY[c] ?? curFY);
      const mc = metaMonths[c] ?? 12;
      // Deduplicate: if a period with the same FY+months already exists, reuse it
      const dup = [...periods.entries()].find(([, p]) => p.fiscal_year === detectedFY && p.months_covered === mc);
      if (dup) {
        colKey.push(dup[0]);
      } else {
        periods.set(label, {
          id: crypto.randomUUID(), label,
          period_type: (metaType[c] ?? "annual") as PeriodType,
          fiscal_year: detectedFY,
          months_covered: mc,
          unit: metaUnit[c] ?? "Lakhs",
          pl: blank(PL_LABELS), bs: blank(BS_LABELS), cf: blank(CF_LABELS),
        });
        colKey.push(label);
      }
    }

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const lineLabel = String(row[0] ?? "").trim();
      if (!lineLabel || lineLabel.startsWith("__") || lineLabel === "---") continue;
      // Skip section header rows (no numeric values in any data column) and instruction text
      if (/^claude\s+instructions?/i.test(lineLabel)) continue;
      const hasAnyValue = colKey.some((_, c) => {
        const v = row[c + 1];
        return v !== "" && v != null && !isNaN(Number(v));
      });
      // Skip rows where ALL data columns are blank and the label is not a known line item
      const isKnownLabel = (PL_LABELS as readonly string[]).includes(lineLabel) ||
        (BS_LABELS as readonly string[]).includes(lineLabel) ||
        (CF_LABELS as readonly string[]).includes(lineLabel);
      if (!hasAnyValue && !isKnownLabel) continue;

      const classified = classifyLabel(lineLabel);
      const rowSection: "pl" | "bs" | "cf" = section !== "auto"
        ? section
        : (classified?.section ?? "pl");
      const rowLabel = classified?.std ?? lineLabel;

      for (let c = 0; c < colKey.length; c++) {
        const p = periods.get(colKey[c]);
        if (!p) continue;
        const raw = row[c + 1];
        const val = raw === "" || raw == null ? null : Number(raw);
        p[rowSection] = setv(p[rowSection], rowLabel, isNaN(val as number) ? null : val);
      }
    }
  }

  // Derive computed fields for each period
  for (const p of periods.values()) {
    const gv = (sec: "pl" | "bs", lbl: string) => getv(p[sec], lbl) ?? 0;
    const gp     = gv("pl", "Turnover") - gv("pl", "Cost of Goods Sold");
    const ebitda = gp - gv("pl", "Operating Expenses");
    const ebit   = ebitda - gv("pl", "Depreciation");
    const pbt    = ebit - gv("pl", "Interest Expense");
    const pat    = pbt - gv("pl", "Tax");
    if (gv("pl", "Gross Profit")      === 0 && gp     !== 0) p.pl = setv(p.pl, "Gross Profit",      gp);
    if (gv("pl", "EBITDA")            === 0 && ebitda !== 0) p.pl = setv(p.pl, "EBITDA",            ebitda);
    if (gv("pl", "EBIT")              === 0 && ebit   !== 0) p.pl = setv(p.pl, "EBIT",              ebit);
    if (gv("pl", "Profit Before Tax") === 0 && pbt    !== 0) p.pl = setv(p.pl, "Profit Before Tax", pbt);
    if (gv("pl", "PAT")               === 0 && pat    !== 0) p.pl = setv(p.pl, "PAT",               pat);
    const nw = gv("bs", "Share Capital") + gv("bs", "Reserves & Surplus");
    const td = gv("bs", "Long Term Borrowings") + gv("bs", "Short Term Borrowings");
    const cl = gv("bs", "Trade Payables") + gv("bs", "Other Current Liabilities") + gv("bs", "Short Term Borrowings");
    const ca = gv("bs", "Inventory") + gv("bs", "Trade Receivables") + gv("bs", "Cash & Bank") + gv("bs", "Other Current Assets");
    const ta = gv("bs", "Fixed Assets (Net)") + ca;
    if (gv("bs", "Net Worth")           === 0 && nw !== 0) p.bs = setv(p.bs, "Net Worth",           nw);
    if (gv("bs", "Total Debt")          === 0 && td !== 0) p.bs = setv(p.bs, "Total Debt",          td);
    if (gv("bs", "Current Liabilities") === 0 && cl !== 0) p.bs = setv(p.bs, "Current Liabilities", cl);
    if (gv("bs", "Current Assets")      === 0 && ca !== 0) p.bs = setv(p.bs, "Current Assets",      ca);
    if (gv("bs", "Total Assets")        === 0 && ta !== 0) p.bs = setv(p.bs, "Total Assets",        ta);
    if (gv("bs", "Total Liabilities")   === 0 && ta !== 0) p.bs = setv(p.bs, "Total Liabilities",   ta);
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
      pl: blank(PL_LABELS), bs: blank(BS_LABELS), cf: blank(CF_LABELS),
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
  section, periods, labels, showAnnualized, auditedItems, auditedUnit,
  onEdit, onEditAudited,
}: {
  section: "pl" | "bs";
  periods: ProvPeriod[];
  labels: string[];
  showAnnualized: boolean;
  auditedItems: LineItem[] | null;
  auditedUnit?: string;
  onEdit: (periodId: string, section: "pl" | "bs", label: string, value: number | null) => void;
  onEditAudited?: (label: string, value: number | null) => void;
}) {
  const [editCell,      setEditCell]      = useState<{ id: string; label: string } | null>(null);
  const [editVal,       setEditVal]       = useState("");
  const [auditEditLabel, setAuditEditLabel] = useState<string | null>(null);
  const [auditEditVal,   setAuditEditVal]   = useState("");

  const startEdit = (id: string, label: string, cur: number | null) => {
    const pUnit = periods.find(pp => pp.id === id)?.unit ?? "Lakhs";
    setEditCell({ id, label });
    const curL = toL(cur, pUnit);
    setEditVal(curL != null ? String(parseFloat(curL.toFixed(4))) : "");
  };
  const commit = () => {
    if (!editCell) return;
    const pUnit = periods.find(pp => pp.id === editCell.id)?.unit ?? "Lakhs";
    const vL = editVal.trim() === "" ? null : parseFloat(editVal);
    const v = fromL(isNaN(vL as number) ? null : vL, pUnit);
    onEdit(editCell.id, section, editCell.label, v);
    setEditCell(null);
  };

  const startAuditEdit = (label: string, cur: number | null) => {
    setAuditEditLabel(label);
    const curL = toL(cur, auditedUnit ?? "Lakhs");
    setAuditEditVal(curL != null ? String(parseFloat(curL.toFixed(4))) : "");
  };
  const commitAuditEdit = () => {
    if (!auditEditLabel) return;
    const vL = auditEditVal.trim() === "" ? null : parseFloat(auditEditVal);
    const v  = fromL(isNaN(vL as number) ? null : vL, auditedUnit ?? "Lakhs");
    onEditAudited?.(auditEditLabel, v);
    setAuditEditLabel(null);
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
                <div className="text-[8px] font-normal text-muted-foreground/60">₹ Lakhs · {p.months_covered}M</div>
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
                  <td className="text-right pr-3 tabular-nums">
                    {auditEditLabel === label ? (
                      <input
                        autoFocus
                        type="number"
                        value={auditEditVal}
                        onChange={e => setAuditEditVal(e.target.value)}
                        onBlur={commitAuditEdit}
                        onKeyDown={e => { if (e.key === "Enter") commitAuditEdit(); if (e.key === "Escape") setAuditEditLabel(null); }}
                        className="w-20 bg-input border border-warning px-1 py-0.5 text-right text-xs focus:outline-none font-mono"
                        title="Edit audited value (₹ Lakhs)"
                      />
                    ) : (
                      <span
                        onClick={() => onEditAudited && startAuditEdit(label, auditedVal)}
                        className={`tabular-nums ${onEditAudited ? "cursor-pointer hover:text-warning hover:underline hover:underline-offset-2" : "text-muted-foreground/60"}`}
                        title={onEditAudited ? "Click to edit audited value" : undefined}
                      >
                        {auditedVal != null ? (
                          <span className="text-muted-foreground/70">{fmtN(toL(auditedVal, auditedUnit ?? "Lakhs"))}</span>
                        ) : "—"}
                      </span>
                    )}
                  </td>
                )}

                {periods.map(p => {
                  const val    = getv(p[section], label);
                  const isEdit = editCell?.id === p.id && editCell?.label === label;
                  return (
                    <td key={p.id} className="text-right pr-2 py-1">
                      {isEdit ? (
                        <input autoFocus type="number" value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          onBlur={commit}
                          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditCell(null); }}
                          className="w-20 bg-input border border-primary px-1 py-0.5 text-right text-xs focus:outline-none font-mono"
                          title="Enter value in ₹ Lakhs" />
                      ) : (
                        <div
                          onClick={() => startEdit(p.id, label, val)}
                          className="cursor-pointer hover:text-primary"
                          title="Click to edit (₹ Lakhs)"
                        >
                          {val != null ? (
                            <>
                              <div className="tabular-nums text-foreground text-xs">
                                {fmtN(toL(val, p.unit))}{" "}
                                <span className="text-[8px] text-muted-foreground/50 font-normal not-italic">L</span>
                              </div>
                              {!/^(lakhs?|lakh)$/i.test(p.unit) && (
                                <div className="text-[8px] text-muted-foreground/50 tabular-nums leading-tight">
                                  {/^(inr|rupees?|rs\.?)$/i.test(p.unit)
                                    ? `₹ ${val.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                                    : `${fmtN(val, 2)} ${p.unit}`}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground/30">—</span>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}

                {showAnn && (
                  <td className="text-right pr-2 tabular-nums text-accent/80 font-medium">
                    {fmtN(toL(annVal, latestP?.unit ?? "Lakhs"))}
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
  cc, periods: initialPeriods, extracted, onSave, onEditAudited,
}: {
  cc: CaseRow;
  periods: ProvPeriod[];
  extracted: ExtractedRow[];
  onSave: (periods: ProvPeriod[]) => Promise<void>;
  onEditAudited?: (section: "pl" | "bs", label: string, value: number | null) => Promise<void>;
}) {
  const [periods,    setPeriods]  = useState<ProvPeriod[]>(
    initialPeriods.map(p => ({ ...p, cf: p.cf ?? blank(CF_LABELS) }))
  );
  const [promptCopied, setPromptCopied] = useState(false);
  const [adding,      setAdding]    = useState(false);
  const [saving,      setSaving]    = useState(false);
  const [saved,       setSaved]     = useState(false);
  const [directImp,   setDirectImp] = useState(false);
  const [showAnn,     setShowAnn]   = useState(true);
  const [showBS,      setShowBS]    = useState(true);
  const directFileRef  = useRef<HTMLInputElement>(null);
  const saveTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender  = useRef(true);
  const historyRef     = useRef<ProvPeriod[][]>([initialPeriods.map(p => ({ ...p, cf: p.cf ?? blank(CF_LABELS) }))]);
  const historyIdxRef  = useRef(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pushHistory = (next: ProvPeriod[]) => {
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(next);
    historyIdxRef.current = historyRef.current.length - 1;
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(false);
  };
  const handleUndo = () => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    setPeriods(historyRef.current[historyIdxRef.current]);
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(true);
  };
  const handleRedo = () => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    setPeriods(historyRef.current[historyIdxRef.current]);
    setCanUndo(true);
    setCanRedo(historyIdxRef.current < historyRef.current.length - 1);
  };

  // Auto-save 800ms after any periods change (skip initial mount)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaving(true); setSaved(false);
    saveTimerRef.current = setTimeout(async () => {
      await onSave(periods);
      setSaving(false); setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 800);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [periods]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const auditedPLUnit = auditedPLRows.find(r => r.fiscal_year === lastAuditedFY)?.unit ?? "Lakhs";
  const auditedBSUnit = auditedBSRows.find(r => r.fiscal_year === lastAuditedFY)?.unit ?? "Lakhs";

  const sorted = [...periods].sort((a, b) => {
    if (a.fiscal_year !== b.fiscal_year) return a.fiscal_year - b.fiscal_year;
    return a.months_covered - b.months_covered;
  });

  // ── Per-FY grouping (used for YoY comparison table only) ──────────────────
  const fyGroups = sorted.reduce<Record<number, ProvPeriod[]>>((acc, p) => {
    (acc[p.fiscal_year] ??= []).push(p);
    return acc;
  }, {});
  const fyList      = Object.keys(fyGroups).map(Number).sort();
  const viewPeriods = sorted;

  const latest = viewPeriods[viewPeriods.length - 1];

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleAdd = (p: ProvPeriod) => {
    const next = [...periods, p];
    setPeriods(next);
    pushHistory(next);
    setAdding(false);
  };

  const handleEdit = (periodId: string, section: "pl" | "bs", label: string, value: number | null) => {
    setPeriods(prev => prev.map(p =>
      p.id !== periodId ? p : { ...p, [section]: setv(p[section], label, value) }
    ));
  };

  const handleRemove = (id: string) => {
    if (!window.confirm("Remove this period?")) return;
    const next = periods.filter(p => p.id !== id);
    setPeriods(next);
    pushHistory(next);
  };

  const handleDirectImport = async (file: File) => {
    setDirectImp(true);
    try {
      const next = await importProvisionalExcel(file, periods);
      setPeriods(next);
      pushHistory(next);
    } catch (e) {
      alert("Import failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDirectImp(false);
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

  const kpiUnit     = kpiPeriod?.unit ?? "Lakhs";
  const annTurnover = kpiPeriod ? toL(annOrDirect(getv(kpiPeriod.pl, "Turnover"), kpiPeriod.months_covered), kpiUnit) : null;
  const annEbitda   = kpiPeriod ? toL(annOrDirect(getv(kpiPeriod.pl, "EBITDA"),   kpiPeriod.months_covered), kpiUnit) : null;
  const annPat      = kpiPeriod ? toL(annOrDirect(getv(kpiPeriod.pl, "PAT"),       kpiPeriod.months_covered), kpiUnit) : null;
  const auditTurn   = auditedPL ? toL(getv(auditedPL, "Turnover"), auditedPLUnit) : null;
  const auditPat    = auditedPL ? toL(getv(auditedPL, "PAT"), auditedPLUnit) : null;

  return (
    <div className="space-y-3">

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-[168px] z-20 bg-white -mx-3 px-4 py-2 border-b border-border shadow-sm">
        <input ref={directFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleDirectImport(f); e.target.value = ""; }} />

        {/* Primary row */}
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => directFileRef.current?.click()} disabled={directImp}
            className="flex items-center gap-2 bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-sm hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50 transition-all">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            {directImp ? "Importing…" : "Import Financial Excel"}
          </button>
          <div className="h-8 w-px bg-border hidden sm:block" />
          <button onClick={async () => { const buf = await buildProvisionalTemplate(); downloadBuffer("Rehbar_Provisional_MIS_Template.xlsx", buf); }}
            className="flex items-center gap-1.5 text-sm text-muted-foreground border border-border rounded-lg px-4 py-2 hover:text-foreground hover:border-primary/50 hover:bg-surface transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download Template
          </button>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(
                "I have attached two files: a financial PDF and an Excel template.\n\nExtract every value from the PDF and fill in the Excel template exactly — place each figure in the correct row. All amounts in ₹ Lakhs. Rename the column headers to match the actual fiscal years shown in the PDF (e.g. FY2024, FY2025). Do not change any row labels in column A. If the data covers a partial period (Q1, H1, 9M), enter the actual figures as-is — do not annualize. Return only the completed Excel file."
              );
              setPromptCopied(true);
              setTimeout(() => setPromptCopied(false), 2000);
            }}
            className="flex items-center gap-1.5 text-sm text-primary/70 border border-primary/30 rounded-lg px-4 py-2 hover:text-primary hover:border-primary/60 hover:bg-primary/5 transition-colors"
            title="Copy a ready-to-use Claude prompt — open Claude, attach the template + PDF, then paste this"
          >
            {promptCopied ? "✓ Copied" : "⧉ Copy AI Prompt"}
          </button>
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-medium text-foreground/70">Fastest way to add financials</span>
            <span className="text-[11px] text-muted-foreground">Fill the template · upload · done. P&amp;L, Balance Sheet, Cash Flow.</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button disabled={!canUndo} onClick={handleUndo} title="Undo (Ctrl+Z)"
              className="text-xs border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:border-primary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              ↩ Undo
            </button>
            <button disabled={!canRedo} onClick={handleRedo} title="Redo (Ctrl+Y)"
              className="text-xs border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:border-primary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              ↪ Redo
            </button>
          </div>
        </div>

        {/* Secondary row */}
        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-border/20">
          <button onClick={() => setAdding(a => !a)} disabled={adding}
            className="text-[10px] tracking-widest border border-accent/50 text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40">
            + ADD PERIOD
          </button>
          {sorted.length > 0 && (
            <button onClick={handleExport}
              className="text-[10px] tracking-widest border border-border text-muted-foreground px-3 py-1.5 hover:text-foreground hover:border-primary/50">
              ⬇ EXPORT EXCEL
            </button>
          )}
          {sorted.length > 0 && (() => {
            const seen = new Map<string, string>();
            const dupeIds: string[] = [];
            for (const p of sorted) {
              const key = `${p.fiscal_year}-${p.months_covered}`;
              const existing = seen.get(key);
              if (existing) {
                const existP = sorted.find(x => x.id === existing)!;
                const existScore = [...existP.pl, ...existP.bs].filter(i => i.value != null).length;
                const curScore   = [...p.pl,     ...p.bs     ].filter(i => i.value != null).length;
                dupeIds.push(curScore >= existScore ? existing : p.id);
                seen.set(key, curScore >= existScore ? p.id : existing);
              } else {
                seen.set(key, p.id);
              }
            }
            if (dupeIds.length === 0) return null;
            return (
              <button onClick={() => {
                if (!window.confirm(`Remove ${dupeIds.length} duplicate period(s)?`)) return;
                const next = periods.filter(p => !dupeIds.includes(p.id));
                setPeriods(next);
                pushHistory(next);
              }} className="text-[10px] tracking-widest border border-warning/50 text-warning/80 px-3 py-1.5 hover:text-warning hover:border-warning/70 transition-colors"
                title="Merge duplicate periods that have the same fiscal year">
                ⚠ REMOVE {dupeIds.length} DUPES
              </button>
            );
          })()}
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer ml-1">
            <input type="checkbox" checked={showAnn} onChange={e => setShowAnn(e.target.checked)} className="accent-primary" />
            SHOW ANNUALIZED
          </label>
          <div className="ml-auto flex gap-2 flex-wrap items-center">
            {viewPeriods.map(p => (
              <button key={p.id} onClick={() => handleRemove(p.id)}
                className="text-[8px] border border-destructive/30 text-destructive/50 hover:text-destructive hover:border-destructive px-1.5 py-0.5 tracking-widest">
                ✕ {p.label}
              </button>
            ))}
            <span className={`text-[9px] tracking-widest transition-opacity ${saving || saved ? "opacity-100" : "opacity-0"} ${saved ? "text-success" : "text-muted-foreground"}`}>
              {saving ? "SAVING…" : "✓ SAVED"}
            </span>
          </div>
        </div>
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
            <div className="terminal-label mt-1">₹ Lakhs · {kpiPeriod && kpiPeriod.months_covered >= 12 ? "Full Year" : "Projected 12M"}</div>
            {auditTurn && <div className={`text-[10px] mt-0.5 ${growthCls(annTurnover && auditTurn ? annTurnover - auditTurn : null)}`}>vs audited FY{lastAuditedFY}: {growthLabel(annTurnover, auditTurn)}</div>}
          </Panel>
          <Panel title={kpiPeriod && kpiPeriod.months_covered >= 12 ? "ANNUAL EBITDA" : "ANNUALIZED EBITDA"} ticker={kpiPeriod?.label ?? ""}>
            <div className="text-2xl font-bold text-warning glow tabular-nums">{fmtN(annEbitda)}</div>
            <div className="terminal-label mt-1">₹ Lakhs</div>
            {annTurnover && annEbitda ? <div className="text-[10px] mt-0.5 text-muted-foreground">Margin: {((annEbitda / annTurnover) * 100).toFixed(1)}%</div> : null}
          </Panel>
          <Panel title={kpiPeriod && kpiPeriod.months_covered >= 12 ? "ANNUAL PAT" : "ANNUALIZED PAT"} ticker={kpiPeriod?.label ?? ""}>
            <div className={`text-2xl font-bold glow tabular-nums ${(annPat ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>{fmtN(annPat)}</div>
            <div className="terminal-label mt-1">₹ Lakhs</div>
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
          <div className="overflow-x-auto">
          <table className="text-xs w-full min-w-max">
            <thead className="text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-1 min-w-[180px]">METRIC</th>
                {fyList.map(fy => (
                  <th key={fy} className="text-right pr-3 min-w-[110px]">FY{fy}</th>
                ))}
                <th className="text-right pr-2 min-w-[80px]">YoY GROWTH</th>
              </tr>
            </thead>
            <tbody>
              {/* P&L metrics */}
              <tr className="border-t border-border/60 bg-surface">
                <td colSpan={fyList.length + 2} className="py-1 pl-1 text-[9px] font-bold tracking-widest text-primary/60">PROFIT & LOSS</td>
              </tr>
              {(["Turnover", "EBITDA", "PAT"] as const).map(label => {
                const vals = fyList.map(fy => {
                  const ann = fyGroups[fy]?.find(p => p.months_covered >= 12);
                  // For partial year, annualize
                  const latest = fyGroups[fy]?.slice().reverse().find(p => p.months_covered < 12);
                  const src = ann ?? latest;
                  if (!src) return null;
                  const v = getv(src.pl, label);
                  const raw = src.months_covered >= 12 ? v : (v != null ? (v / src.months_covered) * 12 : null);
                  return toL(raw, src.unit ?? "Lakhs");
                });
                const prevVal = vals[vals.length - 2];
                const curVal  = vals[vals.length - 1];
                return (
                  <tr key={label} className="border-b border-border/20">
                    <td className="py-1.5 font-medium">{label}</td>
                    {vals.map((v, i) => (
                      <td key={i} className="text-right pr-3 tabular-nums">{fmtN(v)}</td>
                    ))}
                    <td className={`text-right pr-2 tabular-nums font-bold ${growthCls(curVal != null && prevVal != null ? curVal - prevVal : null)}`}>{growthLabel(curVal, prevVal)}</td>
                  </tr>
                );
              })}
              {(["EBITDA", "PAT"] as const).map(label => {
                const margins = fyList.map(fy => {
                  const ann = fyGroups[fy]?.find(p => p.months_covered >= 12);
                  const latest = fyGroups[fy]?.slice().reverse().find(p => p.months_covered < 12);
                  const src = ann ?? latest;
                  if (!src) return null;
                  const v = getv(src.pl, label); const t = getv(src.pl, "Turnover");
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
              {/* Cash flow metrics */}
              {fyList.some(fy => fyGroups[fy]?.some(p => (getv(p.cf ?? [], "Cash from Operations") ?? 0) !== 0)) && (<>
                <tr className="border-t border-border/60 bg-surface">
                  <td colSpan={fyList.length + 2} className="py-1 pl-1 text-[9px] font-bold tracking-widest text-accent/60">CASH FLOW</td>
                </tr>
                {(["Cash from Operations", "Cash from Investing", "Cash from Financing"] as const).map(label => {
                  const vals = fyList.map(fy => {
                    const ann = fyGroups[fy]?.find(p => p.months_covered >= 12);
                    const latest = fyGroups[fy]?.slice().reverse()[0];
                    return getv((ann ?? latest)?.cf ?? [], label);
                  });
                  const prevVal = vals[vals.length - 2]; const curVal = vals[vals.length - 1];
                  return (
                    <tr key={label} className="border-b border-border/20">
                      <td className="py-1.5 font-medium">{label}</td>
                      {vals.map((v, i) => <td key={i} className="text-right pr-3 tabular-nums">{fmtN(v)}</td>)}
                      <td className={`text-right pr-2 tabular-nums font-bold ${growthCls(curVal != null && prevVal != null ? curVal - prevVal : null)}`}>{growthLabel(curVal, prevVal)}</td>
                    </tr>
                  );
                })}
              </>)}
            </tbody>
          </table>
          </div>
        </Panel>
      )}

      {/* ── P&L Table ────────────────────────────────────────────────────────── */}
      {viewPeriods.length > 0 ? (
        <Panel title="PROVISIONAL P&L" ticker="₹ Lakhs · CLICK CELL TO EDIT">
          <FinTable
            section="pl" periods={viewPeriods} labels={PL_LABELS}
            showAnnualized={showAnn} auditedItems={auditedPL} auditedUnit={auditedPLUnit}
            onEdit={handleEdit}
            onEditAudited={onEditAudited ? (label, val) => onEditAudited("pl", label, val) : undefined}
          />
          {showAnn && viewPeriods.some(p => p.months_covered < 12) && (
            <div className="text-[9px] text-muted-foreground mt-2 tracking-wider border-t border-border/20 pt-1.5">
              ▸ ANNUALIZED = latest monthly period × (12 ÷ months covered) · Not a forecast — assumes uniform run-rate
            </div>
          )}
        </Panel>
      ) : (
        <Panel title="NO PROVISIONAL DATA" ticker="MONTHLY / QUARTERLY / SCH III">
          <div className="text-muted-foreground text-xs space-y-2 leading-relaxed">
            <div className="border border-primary/30 bg-primary/5 p-2.5 space-y-1">
              <div className="text-[9px] text-primary tracking-widest font-bold">⬆ DIRECT ANNUAL IMPORT — QUICKEST</div>
              <p>Use the <span className="text-primary font-bold">DIRECT ANNUAL IMPORT</span> button above for simple column-based Excel files:</p>
              <p className="font-mono text-[9px] text-foreground/70">Particulars | FY2024 | FY2025 | FY2026</p>
              <p className="font-mono text-[9px] text-foreground/70">Turnover    | 1200   | 1450   | 1700</p>
              <p className="font-mono text-[9px] text-foreground/70">Net Worth   | 320    | 410    | 520</p>
              <p className="text-[9px] text-muted-foreground/70">Labels auto-mapped · Multiple sheets OK · FY columns auto-detected</p>
            </div>
            <div className="space-y-0.5">
              <div className="text-[9px] text-muted-foreground/60 tracking-widest font-bold">⬆ IMPORT EXCEL — ADVANCED FORMATS</div>
              <p>Monthly MIS tracking · Sch III (BS + P&amp;L + Cashflow sheets) · Round-trip template</p>
              <p>Sch III: sheets named BS/Balance Sheet, P&amp;L/Profit Loss, Cashflow — dates from column headers like "31st January 2026".</p>
            </div>
          </div>
        </Panel>
      )}

      {/* ── Balance Sheet Table ───────────────────────────────────────────────── */}
      {viewPeriods.length > 0 && (
        <Panel
          title="PROVISIONAL BALANCE SHEET"
          ticker="₹ Lakhs · CLICK CELL TO EDIT"
          actions={
            <button onClick={() => setShowBS(s => !s)} className="text-[9px] border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground tracking-widest">
              {showBS ? "COLLAPSE" : "EXPAND"}
            </button>
          }
        >
          {showBS && (
            <FinTable
              section="bs" periods={viewPeriods} labels={BS_LABELS}
              showAnnualized={false} auditedItems={auditedBS} auditedUnit={auditedBSUnit}
              onEdit={handleEdit}
              onEditAudited={onEditAudited ? (label, val) => onEditAudited("bs", label, val) : undefined}
            />
          )}
        </Panel>
      )}

      {/* ── Cash Flow Table ───────────────────────────────────────────────────── */}
      {viewPeriods.length > 0 && viewPeriods.some(p => (p.cf ?? []).some(i => i.value != null)) && (
        <Panel
          title="PROVISIONAL CASH FLOW"
          ticker="CLICK CELL TO EDIT"
        >
          <FinTable
            section="cf" periods={viewPeriods} labels={CF_LABELS}
            showAnnualized={false} auditedItems={null}
            onEdit={handleEdit}
          />
        </Panel>
      )}

      {/* ── Period-over-period growth ─────────────────────────────────────────── */}
      {viewPeriods.length >= 2 && (() => {
        // Only compare monthly periods — exclude the annual summary column
        const growthPeriods = viewPeriods.filter(p => p.months_covered < 12);
        if (growthPeriods.length < 2) return null;
        return (
          <Panel title="PERIOD-OVER-PERIOD GROWTH" ticker="MoM TREND">
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
