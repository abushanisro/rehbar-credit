import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, ShadingType, WidthType, BorderStyle,
  Header, Footer, PageNumber, TabStopType, convertInchesToTwip, ImageRun,
} from "docx";
import type { IcNoteShape } from "@/tabs/case/ic/ICNoteDocument";
import type { CaseRow, ExtractedRow, RatioRow } from "@/features/case/types";

// ── Constants ─────────────────────────────────────────────────────────────────
// Page: Letter (8.5") – 0.75" margins → content = 7" = 10080 twips
const CW = 10080; // content width in twips

const COL = {
  twoLabel: 2520,  // 1.75" label col
  twoValue: 7560,  // 5.25" value col
  deal: [1800, 3240, 1800, 3240] as number[], // 4-col deal table
  finLabel: 2880,  // financial label col
};

// Colours (hex without #)
const CLR = {
  navy:   "0F1B2D",
  gold:   "F5C518",
  white:  "FFFFFF",
  body:   "1C1C1E",
  muted:  "888888",
  altRow: "F5F5F0",
  amber:  "D97706",
  green:  "166534",
  red:    "991B1B",
  blue:   "1E40AF",
};

// Sizes in half-points (so 20 = 10pt, 24 = 12pt, 28 = 14pt)
const SZ = { sm: 16, base: 20, md: 22, lg: 24, xl: 28, xxl: 36, cover: 56 };

// ── Inline threshold evaluation (guards against stale DB threshold_status) ───
const WORD_THRESHOLDS: Record<string, { g: number; a: number; hi: boolean }> = {
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
function wordRatioStatus(name: string, value: number | null, stored: string | null | undefined): string {
  if (value === null || !Number.isFinite(value)) return stored ?? "na";
  const t = WORD_THRESHOLDS[name];
  if (!t) return stored ?? "na";
  if (t.hi) return value >= t.g ? "green" : value >= t.a ? "amber" : "red";
  return value <= t.g ? "green" : value <= t.a ? "amber" : "red";
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function trunc(s: string | null | undefined, n: number): string {
  const v = s ?? "";
  return v.length > n ? v.slice(0, n - 1) + "…" : v;
}
function cap(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
function fmtNum(v: number | null): string {
  if (v === null) return "—";
  if (Math.abs(v) === 0) return "0.00";
  return v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function scaleUnit(v: number | null, unit: string | null): number | null {
  if (v === null) return null;
  const u = (unit ?? "").toLowerCase();
  if (u.includes("lakh") || u.includes("crore") || u.includes("million") || u.includes("thousand")) return v;
  return v / 100_000;
}
function unitLabel(unit: string | null): string {
  if (!unit) return "Lakhs";
  const u = unit.toLowerCase();
  if (u.includes("crore")) return "Crores";
  return "Lakhs";
}

// Thin transparent border (removes default Word table borders)
const BORDER_THIN = { style: BorderStyle.SINGLE, size: 2, color: "E5E5E0" };
const BORDERS_THIN = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };

async function fetchLogo(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch("/Rehbar_logo.png");
    if (!res.ok) return null;
    return res.arrayBuffer();
  } catch { return null; }
}

// ── Building blocks ───────────────────────────────────────────────────────────

function spacer(size = 120): Paragraph {
  return new Paragraph({ children: [], spacing: { before: size, after: 0 } });
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [new TextRun({ break: 1 } as never)] });
}

// Navy section header paragraph (mimics SlideShell navy bar)
function sectionHdr(roman: string | null, title: string): Paragraph {
  return new Paragraph({
    children: [
      ...(roman
        ? [new TextRun({ text: roman + "   ", color: CLR.gold, bold: true, size: SZ.xl, font: "Georgia" })]
        : []),
      new TextRun({ text: title, color: CLR.white, bold: true, size: SZ.lg, font: "Georgia" }),
    ],
    shading: { type: ShadingType.CLEAR, color: "auto", fill: CLR.navy },
    spacing: { before: 280, after: 100 },
    indent: { left: convertInchesToTwip(0.15), right: convertInchesToTwip(0.15) },
  });
}

// Gold table header row
function goldRow(labels: string[], widths: number[]): TableRow {
  return new TableRow({
    tableHeader: true,
    children: labels.map((l, i) =>
      new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text: l, bold: true, color: CLR.body, size: SZ.base, font: "Calibri" })],
          alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT,
          spacing: { before: 60, after: 60 },
          indent: { left: 80, right: 80 },
        })],
        shading: { type: ShadingType.CLEAR, color: "auto", fill: CLR.gold },
        width: { size: widths[i], type: WidthType.DXA },
        borders: BORDERS_THIN,
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
      }),
    ),
  });
}

// Data row (alternating bg)
function dataRow(values: string[], widths: number[], ri: number, firstLeft = true): TableRow {
  const bg = ri % 2 === 0 ? CLR.white : CLR.altRow;
  return new TableRow({
    children: values.map((v, i) =>
      new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text: v, color: CLR.body, size: SZ.base, font: "Calibri" })],
          alignment: (firstLeft && i === 0) ? AlignmentType.LEFT : AlignmentType.RIGHT,
          spacing: { before: 40, after: 40 },
          indent: { left: 80, right: 80 },
        })],
        shading: { type: ShadingType.CLEAR, color: "auto", fill: bg },
        width: { size: widths[i], type: WidthType.DXA },
        borders: BORDERS_THIN,
        margins: { top: 50, bottom: 50, left: 80, right: 80 },
      }),
    ),
  });
}

// Bold label + plain value row (for 2-col key-value)
function kvRow(label: string, value: string, ri: number): TableRow {
  const bg = ri % 2 === 0 ? CLR.white : CLR.altRow;
  return new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, color: CLR.navy, size: SZ.base, font: "Calibri" })], spacing: { before: 50, after: 50 }, indent: { left: 80 } })],
        shading: { type: ShadingType.CLEAR, color: "auto", fill: bg },
        width: { size: COL.twoLabel, type: WidthType.DXA },
        borders: BORDERS_THIN,
        margins: { top: 50, bottom: 50, left: 80, right: 80 },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: value, color: CLR.body, size: SZ.base, font: "Calibri" })], spacing: { before: 50, after: 50 }, indent: { left: 80 } })],
        shading: { type: ShadingType.CLEAR, color: "auto", fill: bg },
        width: { size: COL.twoValue, type: WidthType.DXA },
        borders: BORDERS_THIN,
        margins: { top: 50, bottom: 50, left: 80, right: 80 },
      }),
    ],
  });
}

function goldKvTable(pairs: [string, string][]): Table {
  const hdr = goldRow(["Field", "Details"], [COL.twoLabel, COL.twoValue]);
  const rows = pairs.map(([l, v], i) => kvRow(l, v, i));
  return new Table({
    width: { size: CW, type: WidthType.DXA },
    rows: [hdr, ...rows],
    borders: { insideH: BORDER_THIN, insideV: BORDER_THIN, ...BORDERS_THIN },
  });
}

// Narrative section body — supports both rows format (new) and headline+bullets (legacy)
interface RowItem { label: string; text?: string; items?: string[] }
interface SectionTemplate {
  rows?: RowItem[];
  flags?: string[];
  headline?: string;
  bullets?: string[];
  generated_at?: string;
}

function narrativeBody(tpl: SectionTemplate | undefined): (Paragraph | Table)[] {
  if (!tpl || (!tpl.rows?.length && !tpl.headline && !tpl.bullets?.length)) {
    return [new Paragraph({
      children: [new TextRun({ text: "Section not yet generated — click Generate in the IC Deck tab.", color: CLR.muted, size: SZ.base, font: "Calibri", italics: true })],
      spacing: { before: 120, after: 80 },
    })];
  }

  const out: (Paragraph | Table)[] = [];

  // ── Rows format (new): render as 2-col label|value table ──────────────────
  if (tpl.rows && tpl.rows.length > 0) {
    const labelW = 2520;
    const valueW = CW - labelW;
    const rows = tpl.rows.map((row, i) => {
      const bg = i % 2 === 0 ? CLR.white : CLR.altRow;
      const contentParas: Paragraph[] = row.items?.length
        ? row.items.map(item => new Paragraph({
            children: [
              new TextRun({ text: "▸  ", color: CLR.navy, bold: true, size: SZ.sm, font: "Calibri" }),
              new TextRun({ text: item, color: CLR.body, size: SZ.base, font: "Calibri" }),
            ],
            spacing: { before: 30, after: 30 },
          }))
        : (row.text ?? "").split("\n").filter(l => l.trim()).map(line => new Paragraph({
            children: [new TextRun({ text: line, color: CLR.body, size: SZ.base, font: "Calibri" })],
            spacing: { before: 30, after: 30 },
          }));

      return new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({
              children: [new TextRun({ text: row.label, bold: true, color: CLR.navy, size: SZ.base, font: "Calibri" })],
              spacing: { before: 50, after: 50 },
              indent: { left: 80 },
            })],
            shading: { type: ShadingType.CLEAR, color: "auto", fill: bg },
            width: { size: labelW, type: WidthType.DXA },
            borders: BORDERS_THIN,
            margins: { top: 50, bottom: 50, left: 80, right: 80 },
          }),
          new TableCell({
            children: contentParas,
            shading: { type: ShadingType.CLEAR, color: "auto", fill: bg },
            width: { size: valueW, type: WidthType.DXA },
            borders: BORDERS_THIN,
            margins: { top: 50, bottom: 50, left: 80, right: 80 },
          }),
        ],
      });
    });

    out.push(new Table({
      width: { size: CW, type: WidthType.DXA },
      rows,
      borders: { insideH: BORDER_THIN, insideV: BORDER_THIN, ...BORDERS_THIN },
    }));
  }

  // ── Legacy: headline + bullets ─────────────────────────────────────────────
  if (!tpl.rows?.length) {
    if (tpl.headline) {
      out.push(new Paragraph({
        children: [new TextRun({ text: tpl.headline, color: CLR.body, size: SZ.md, font: "Georgia", italics: true })],
        spacing: { before: 160, after: 100 },
      }));
    }
    for (const b of tpl.bullets ?? []) {
      out.push(new Paragraph({
        children: [
          new TextRun({ text: "•  ", color: CLR.navy, bold: true, size: SZ.base, font: "Calibri" }),
          new TextRun({ text: b, color: CLR.body, size: SZ.base, font: "Calibri" }),
        ],
        spacing: { before: 60, after: 60 },
        indent: { left: convertInchesToTwip(0.25) },
      }));
    }
  }

  // ── Flags (both formats) ───────────────────────────────────────────────────
  for (const f of tpl.flags ?? []) {
    out.push(new Paragraph({
      children: [
        new TextRun({ text: "⚠  ", color: CLR.amber, bold: true, size: SZ.base, font: "Calibri" }),
        new TextRun({ text: f, color: CLR.body, size: SZ.base, font: "Calibri" }),
      ],
      spacing: { before: 60, after: 60 },
      indent: { left: convertInchesToTwip(0.25) },
    }));
  }

  return out;
}

// ── Financial helpers ─────────────────────────────────────────────────────────
interface LineItem { label: string; value: number | null; override_value?: number | null }

function histFyYears(extracted: ExtractedRow[]): number[] {
  return [...new Set(
    extracted.filter(r => r.statement_type !== "projections" && r.fiscal_year != null).map(r => r.fiscal_year as number),
  )].sort((a, b) => a - b);
}

function rawUnit(extracted: ExtractedRow[]): string | null {
  return extracted.find(r => r.statement_type !== "projections" && r.unit)?.unit ?? null;
}

function liVal(extracted: ExtractedRow[], fy: number, label: string, unit: string | null): number | null {
  for (const row of extracted.filter(r => r.fiscal_year === fy && r.statement_type !== "projections")) {
    const items = (row.line_items as unknown as LineItem[]) ?? [];
    const item = items.find(i => i.label === label);
    if (item) {
      const v = item.override_value !== undefined && item.override_value !== null ? item.override_value : item.value;
      return scaleUnit(v, unit);
    }
  }
  return null;
}

const PROJ_ALIASES: Record<string, string[]> = {
  "Projected Turnover":   ["Projected Turnover","Projected Revenue","Revenue","Total Income","Turnover","Net Sales"],
  "Projected EBITDA":     ["Projected EBITDA","EBITDA","Projected Gross Profit","Gross Profit"],
  "Projected PAT":        ["Projected PAT","Projected Net Profit","PAT","Net Profit"],
  "Projected Net Worth":  ["Projected Net Worth","Net Worth","Shareholders Equity","Total Equity"],
  "Projected Total Debt": ["Projected Total Debt","Total Debt"],
};

function projVal(extracted: ExtractedRow[], fy: number, label: string): number | null {
  const row = extracted.find(r => r.statement_type === "projections" && r.fiscal_year === fy);
  if (!row) return null;
  const items = (row.line_items as unknown as LineItem[]) ?? [];
  for (const alias of PROJ_ALIASES[label] ?? [label]) {
    const it = items.find(i => i.label === alias);
    if (it) {
      const v = it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
      if (v !== null) return Number(v);
    }
  }
  return null;
}

function finTable(extracted: ExtractedRow[], labels: string[], uLabel: string): (Paragraph | Table)[] {
  const unit = rawUnit(extracted);
  const shownY = histFyYears(extracted).slice(-5);
  if (!shownY.length) return [new Paragraph({ children: [new TextRun({ text: "No historical data available.", color: CLR.muted, size: SZ.base, italics: true, font: "Calibri" })], spacing: { before: 80, after: 80 } })];

  const yearCols = shownY.length;
  const yearW = Math.floor((CW - COL.finLabel - 1200) / yearCols); // 1200 for YoY col
  const widths = [COL.finLabel, ...shownY.map(() => yearW), 1200];
  const headers = [`Item (₹ ${uLabel})`, ...shownY.map(y => `FY ${y}`), "YoY %"];

  const rows: string[][] = [];
  for (const label of labels) {
    const vals = shownY.map(y => liVal(extracted, y, label, unit));
    if (vals.every(v => v === null)) continue;
    const last = vals[vals.length - 1];
    const prev = vals[vals.length - 2] ?? null;
    let yoy = "—";
    if (last !== null && prev !== null && prev !== 0) {
      const pct = ((last - prev) / Math.abs(prev)) * 100;
      yoy = `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
    }
    rows.push([label, ...vals.map(fmtNum), yoy]);
  }

  if (!rows.length) return [new Paragraph({ children: [new TextRun({ text: "No data for these items.", color: CLR.muted, size: SZ.base, italics: true, font: "Calibri" })], spacing: { before: 80, after: 80 } })];

  return [new Table({
    width: { size: CW, type: WidthType.DXA },
    rows: [goldRow(headers, widths), ...rows.map((r, i) => dataRow(r, widths, i))],
    borders: { insideH: BORDER_THIN, insideV: BORDER_THIN, ...BORDERS_THIN },
  })];
}

const RATIO_NAMES: Record<string, string> = {
  dscr: "DSCR", icr: "ICR", fccr: "FCCR",
  current_ratio: "Current Ratio", quick_ratio: "Quick Ratio", cash_ratio: "Cash Ratio",
  debt_equity: "D/E Ratio", debt_ebitda: "Debt/EBITDA", leverage: "Leverage",
  gross_margin: "Gross Margin %", ebitda_margin: "EBITDA Margin %", pat_margin: "PAT Margin %",
  net_margin: "Net Margin %", roe: "ROE", roce: "ROCE", ronw: "RONW",
  inventory_days: "Inventory Days", debtor_days: "Debtor Days", creditor_days: "Creditor Days",
  asset_turnover: "Asset Turnover",
};

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateIcDeckWord(params: {
  cc: CaseRow;
  ic: IcNoteShape;
  extracted: ExtractedRow[];
  ratios: RatioRow[];
  company?: Record<string, string | null> | null;
  directors?: Record<string, string | null>[] | null;
  photoBlobs?: { name: string; data: ArrayBuffer; mimeType: string }[];
}): Promise<void> {
  const { cc, ic, extracted, ratios, company, directors, photoBlobs = [] } = params;
  const clientName = cc.client_name ?? "Borrower";
  const tpls = (ic.section_templates ?? {}) as Record<string, SectionTemplate>;
  const logo = await fetchLogo();

  const SKIP_KEYS = new Set(["id","created_at","updated_at","case_id","org_id","company_id","user_id","vector","embedding","search_vector"]);

  const children: (Paragraph | Table)[] = [];

  // ── Cover ─────────────────────────────────────────────────────────────────
  // Navy top bar paragraph
  children.push(new Paragraph({
    children: [new TextRun({ text: "REHBAR FINANCIAL SERVICES", color: CLR.gold, bold: true, size: SZ.xl, font: "Georgia", characterSpacing: 80 })],
    shading: { type: ShadingType.CLEAR, color: "auto", fill: CLR.navy },
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    indent: { left: convertInchesToTwip(0.15), right: convertInchesToTwip(0.15) },
  }));

  if (logo) {
    children.push(new Paragraph({
      children: [new ImageRun({ type: "png", data: logo, transformation: { width: 180, height: 47 } })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 0 },
    }));
  }

  children.push(spacer(480));

  children.push(new Paragraph({
    children: [new TextRun({ text: "Investment Committee Deck", color: CLR.muted, size: SZ.md, font: "Calibri", characterSpacing: 60 })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 160 },
  }));

  children.push(new Paragraph({
    children: [new TextRun({ text: clientName, color: CLR.navy, bold: true, size: SZ.cover, font: "Georgia" })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 160 },
  }));

  const prodLabel = cc.product_type ? cap(cc.product_type) : "Credit Facility";
  children.push(new Paragraph({
    children: [new TextRun({ text: prodLabel, color: CLR.muted, size: SZ.xl, font: "Calibri" })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 120 },
  }));

  const amt  = cc.deal_amount != null ? `₹ ${Number(cc.deal_amount).toFixed(2)} Cr` : "";
  const date = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  children.push(new Paragraph({
    children: [new TextRun({ text: [amt, date].filter(Boolean).join("  ·  "), color: CLR.muted, size: SZ.md, font: "Calibri" })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 480 },
  }));

  // Gold bottom bar on cover
  children.push(new Paragraph({
    children: [new TextRun({ text: "Confidential – Rehbar Financial Services", color: CLR.navy, bold: true, size: SZ.base, font: "Calibri" })],
    shading: { type: ShadingType.CLEAR, color: "auto", fill: CLR.gold },
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
  }));

  children.push(pageBreak());

  // ── Table of Contents ──────────────────────────────────────────────────────
  children.push(sectionHdr(null, "Table of Contents"));
  children.push(spacer(80));

  const tocItems = [
    ["I",    "Executive Summary"],
    ["II",   "Client & Promoter Profile"],
    ["III",  "Proposed Investment Structure"],
    ["IV",   "Rehbar Funding History"],
    ["V",    "Historical Financial Analysis (7 sub-sections)"],
    ["VI",   "Projections & Estimates"],
    ["VII",  "Key Financial Ratios (9 categories)"],
    ["VIII", "Cash Flow Statement"],
    ["IX",   "Due Diligence Excerpts"],
    ["X",    "Risk Assessment & Mitigation"],
    ["XI",   "Visit Report"],
    ["XII",  "Executive Team Recommendation"],
    ["XIII", "Specific Product Requirements"],
    ["XIV",  "Triangulation Analysis"],
    ["XV",   "Conditions Precedent"],
    ["XVI",  "SWOT Analysis"],
  ];

  const tocWidths = [800, CW - 800];
  const tocHdr = goldRow(["#", "Section"], tocWidths);
  const tocRows = tocItems.map(([r, t], i) => new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: r, bold: true, color: CLR.navy, size: SZ.base, font: "Georgia" })], spacing: { before: 60, after: 60 }, alignment: AlignmentType.CENTER })],
        shading: { type: ShadingType.CLEAR, color: "auto", fill: i % 2 === 0 ? CLR.white : CLR.altRow },
        width: { size: tocWidths[0], type: WidthType.DXA }, borders: BORDERS_THIN,
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: t, color: CLR.body, size: SZ.base, font: "Calibri" })], spacing: { before: 60, after: 60 }, indent: { left: 80 } })],
        shading: { type: ShadingType.CLEAR, color: "auto", fill: i % 2 === 0 ? CLR.white : CLR.altRow },
        width: { size: tocWidths[1], type: WidthType.DXA }, borders: BORDERS_THIN,
      }),
    ],
  }));
  children.push(new Table({ width: { size: CW, type: WidthType.DXA }, rows: [tocHdr, ...tocRows], borders: { insideH: BORDER_THIN, insideV: BORDER_THIN, ...BORDERS_THIN } }));

  children.push(pageBreak());

  // ── Deal Summary ───────────────────────────────────────────────────────────
  children.push(sectionHdr(null, "Deal Summary"));
  children.push(spacer(80));

  const dealPairs: [string, string, string, string][] = [
    ["Borrower", trunc(clientName, 50), "Case Reference", cc.case_code ?? "—"],
    ["Product", trunc(cc.product_type ? cap(cc.product_type) : "—", 40), "Deal Amount", cc.deal_amount != null ? `₹ ${Number(cc.deal_amount).toFixed(2)} Cr` : "—"],
    ["Tenure", cc.tenure_months != null ? `${cc.tenure_months} Months` : "—", "Expected IRR", cc.expected_irr != null ? `${Number(cc.expected_irr)}% p.a.` : "—"],
    ["Industry", trunc(cc.industry ?? "—", 36), "Constitution", trunc(cc.legal_constitution ?? "—", 36)],
    ["End Use", trunc(cc.end_use ?? "—", 55), "Collateral", trunc(cc.collateral_summary ?? "—", 55)],
  ];
  const dealHdr = goldRow(["Parameter", "Value", "Parameter", "Value"], COL.deal);
  const dealRows = dealPairs.map((row, i) => {
    const bg = i % 2 === 0 ? CLR.white : CLR.altRow;
    const mkCell = (text: string, bold = false) => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold, color: bold ? CLR.navy : CLR.body, size: SZ.base, font: "Calibri" })], spacing: { before: 80, after: 80 }, indent: { left: 80 } })],
      shading: { type: ShadingType.CLEAR, color: "auto", fill: bg }, borders: BORDERS_THIN,
      margins: { top: 80, bottom: 80, left: 80, right: 80 },
    });
    return new TableRow({ children: [mkCell(row[0], true), mkCell(row[1]), mkCell(row[2], true), mkCell(row[3])] });
  });
  children.push(new Table({ width: { size: CW, type: WidthType.DXA }, rows: [dealHdr, ...dealRows], borders: { insideH: BORDER_THIN, insideV: BORDER_THIN, ...BORDERS_THIN } }));

  children.push(pageBreak());

  // ── Company Profile ────────────────────────────────────────────────────────
  if (company && Object.keys(company).length > 0) {
    const entries = Object.entries(company)
      .filter(([k, v]) => !SKIP_KEYS.has(k) && v != null && String(v).trim())
      .map(([k, v]) => [cap(k), String(v)] as [string, string]);
    if (entries.length) {
      children.push(sectionHdr(null, "Company Profile"));
      children.push(spacer(80));
      children.push(goldKvTable(entries));
      children.push(spacer(200));
    }
  }

  // ── Directors ──────────────────────────────────────────────────────────────
  if (directors && directors.length > 0) {
    children.push(sectionHdr(null, "Corporate Governance — Directors"));
    children.push(spacer(80));
    const PREF = ["name","din","designation","appointed","shareholding","age"];
    const allKeys = [...new Set(directors.flatMap(d => Object.keys(d)))].filter(k => !SKIP_KEYS.has(k));
    const cols = [...PREF.filter(k => allKeys.includes(k)), ...allKeys.filter(k => !PREF.includes(k))].slice(0, 6);
    const firstW = Math.floor(CW * 0.25);
    const restW  = Math.floor((CW - firstW) / Math.max(cols.length - 1, 1));
    const cWidths = [firstW, ...cols.slice(1).map(() => restW)];
    const dirHdr = goldRow(cols.map(cap), cWidths);
    const dirRows = directors.map((d, ri) => dataRow(cols.map(k => trunc(String(d[k] ?? "—"), 35)), cWidths, ri, true));
    children.push(new Table({ width: { size: CW, type: WidthType.DXA }, rows: [dirHdr, ...dirRows], borders: { insideH: BORDER_THIN, insideV: BORDER_THIN, ...BORDERS_THIN } }));
    children.push(spacer(200));
  }

  children.push(pageBreak());

  // ── Narrative sections helper ──────────────────────────────────────────────
  function addNarrative(roman: string, title: string, id: string): void {
    children.push(sectionHdr(roman, title));
    narrativeBody(tpls[id]).forEach(p => children.push(p));
    children.push(spacer(160));
  }

  // ── I–IV ─────────────────────────────────────────────────────────────────
  addNarrative("I",   "Executive Summary",        "executive_summary");
  addNarrative("II",  "Client & Promoter Profile","client_promoter");

  // III – Investment Structure (table + narrative)
  children.push(sectionHdr("III", "Proposed Investment Structure"));
  children.push(spacer(80));
  const invPairs: [string, string][] = [
    ["Product Type",       cc.product_type ? cap(cc.product_type) : "—"],
    ["Deal Amount",        cc.deal_amount != null ? `₹ ${Number(cc.deal_amount).toFixed(2)} Cr` : "—"],
    ["Tenure",             cc.tenure_months != null ? `${cc.tenure_months} months` : "—"],
    ["Expected IRR",       cc.expected_irr != null ? `${Number(cc.expected_irr)}% p.a.` : "—"],
    ["End Use",            trunc(cc.end_use ?? "—", 80)],
    ["Collateral",         trunc(cc.collateral_summary ?? "—", 80)],
    ["Legal Constitution", trunc(cc.legal_constitution ?? "—", 60)],
  ];
  children.push(goldKvTable(invPairs));
  children.push(spacer(160));

  // ── IV – Rehbar Funding History (structured tables from ic.rehbar_history) ──
  {
    children.push(sectionHdr("IV", "Rehbar Funding History"));
    const hist = ic.rehbar_history;
    if (!hist) {
      children.push(new Paragraph({ children: [new TextRun({ text: "No Rehbar history data recorded.", color: CLR.muted, size: SZ.base, font: "Calibri", italics: true })], spacing: { before: 80, after: 80 } }));
    } else {
      // Relationship banner
      const hasPrior = hist.has_prior_exposure;
      children.push(new Paragraph({
        children: [new TextRun({ text: hasPrior ? "⬤  Prior Rehbar Exposure" : "⬤  New Relationship — First-Time Exposure", bold: true, color: hasPrior ? "D97706" : CLR.green, size: SZ.base, font: "Calibri" })],
        shading: { type: ShadingType.CLEAR, color: "auto", fill: hasPrior ? "FFF8E1" : "F0FDF4" },
        spacing: { before: 120, after: 100 },
        indent: { left: 120, right: 120 },
      }));

      // Prior facilities table
      if (hasPrior && hist.facilities.length > 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: "PRIOR FACILITIES", bold: true, color: CLR.muted, size: SZ.sm, font: "Calibri", characterSpacing: 40 })], spacing: { before: 100, after: 50 } }));
        const fW = [1440, 1200, 1200, 1100, 1200, 1200, 900, 700, 1140] as number[];
        const fHdr = goldRow(["Product", "Sanctioned", "Disbursed", "O/S", "Sanction Date", "Closure Date", "Status", "Max DPD", "Notes"], fW);
        const fmtL2 = (v: number | null) => v !== null ? `₹${v.toLocaleString("en-IN")}L` : "—";
        const fRows = hist.facilities.map((f, i) => {
          const bg = i % 2 === 0 ? CLR.white : CLR.altRow;
          const vals = [f.product, fmtL2(f.sanctioned_amount), fmtL2(f.disbursed_amount), fmtL2(f.outstanding), f.sanction_date || "—", f.closure_date || "—", f.status, f.max_dpd != null ? `${f.max_dpd}d` : "—", f.notes || "—"];
          return new TableRow({ children: vals.map((v, ci) => new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: String(v), color: CLR.body, size: SZ.sm, font: "Calibri" })], spacing: { before: 40, after: 40 }, indent: { left: 60 }, alignment: ci === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT })],
            shading: { type: ShadingType.CLEAR, color: "auto", fill: bg },
            width: { size: fW[ci], type: WidthType.DXA }, borders: BORDERS_THIN,
          })) });
        });
        children.push(new Table({ width: { size: CW, type: WidthType.DXA }, rows: [fHdr, ...fRows], borders: { insideH: BORDER_THIN, insideV: BORDER_THIN, ...BORDERS_THIN } }));
        children.push(spacer(100));
      }

      // Credit references table
      if (hist.credit_references.length > 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: "CREDIT REFERENCES", bold: true, color: CLR.muted, size: SZ.sm, font: "Calibri", characterSpacing: 40 })], spacing: { before: 100, after: 50 } }));
        const rW = [1200, 2200, 2000, 2000, 2680] as number[];
        const rHdr = goldRow(["Type", "Entity", "Contact", "Relationship", "Notes"], rW);
        const rRows = hist.credit_references.map((r, i) => dataRow([r.ref_type, r.entity_name || "—", r.contact || "—", r.relationship || "—", r.notes || "—"], rW, i, true));
        children.push(new Table({ width: { size: CW, type: WidthType.DXA }, rows: [rHdr, ...rRows], borders: { insideH: BORDER_THIN, insideV: BORDER_THIN, ...BORDERS_THIN } }));
        children.push(spacer(100));
      }

      // Analyst notes
      if (hist.analyst_notes?.trim()) {
        children.push(new Paragraph({ children: [new TextRun({ text: "ANALYST NOTES", bold: true, color: CLR.muted, size: SZ.sm, font: "Calibri", characterSpacing: 40 })], spacing: { before: 100, after: 50 } }));
        children.push(new Paragraph({ children: [new TextRun({ text: hist.analyst_notes, color: CLR.body, size: SZ.base, font: "Calibri" })], shading: { type: ShadingType.CLEAR, color: "auto", fill: CLR.altRow }, spacing: { before: 60, after: 80 }, indent: { left: 120 } }));
      }
    }
    // AI narrative overlay (if generated via Generate button)
    narrativeBody(tpls["rehbar_funding_history"]).forEach(p => children.push(p));
    children.push(spacer(160));
  }

  children.push(pageBreak());

  // ── Section V – Historical Financials ─────────────────────────────────────
  const unit = rawUnit(extracted);
  const uLabel = unitLabel(unit);

  const histGroups: { title: string; labels: string[] }[] = [
    { title: `Historical Financials – P&L (1/2)  (₹ ${uLabel})`,
      labels: ["Turnover","Cost of Goods Sold","Gross Profit","Operating Expenses","EBITDA"] },
    { title: `Historical Financials – P&L (2/2)  (₹ ${uLabel})`,
      labels: ["EBIT","Interest Expense","Profit Before Tax","Tax","PAT"] },
    { title: `Historical Financials – Balance Sheet (1/3)  (₹ ${uLabel})`,
      labels: ["Fixed Assets (Net)","Inventory","Trade Receivables","Cash & Bank","Current Assets"] },
    { title: `Historical Financials – Balance Sheet (2/3)  (₹ ${uLabel})`,
      labels: ["Trade Payables","Short Term Borrowings","Long Term Borrowings","Current Liabilities","Total Debt"] },
    { title: `Historical Financials – Balance Sheet (3/3)  (₹ ${uLabel})`,
      labels: ["Net Worth","Capital Employed","Working Capital","Total Assets"] },
  ];

  for (const grp of histGroups) {
    children.push(sectionHdr("V", grp.title));
    children.push(spacer(80));
    finTable(extracted, grp.labels, uLabel).forEach(el => children.push(el));
    children.push(spacer(200));
  }

  // V-f: Projections
  {
    const projYears = [...new Set(
      extracted.filter(r => r.statement_type === "projections" && r.fiscal_year != null).map(r => r.fiscal_year as number),
    )].sort((a, b) => a - b);

    children.push(sectionHdr("V", "Projected Financials  (₹ Lakhs)"));
    children.push(spacer(80));

    if (!projYears.length) {
      children.push(new Paragraph({ children: [new TextRun({ text: "No projection data available.", color: CLR.muted, size: SZ.base, font: "Calibri", italics: true })], spacing: { before: 80, after: 80 } }));
    } else {
      const projLabels = ["Projected Turnover","Projected EBITDA","Projected PAT","Projected Net Worth","Projected Total Debt"];
      const pW = Math.floor((CW - COL.finLabel) / projYears.length);
      const pWidths = [COL.finLabel, ...projYears.map(() => pW)];
      const pHdr = goldRow(["Metric (₹ Lakhs)", ...projYears.map(y => `FY ${y} (P)`)], pWidths);
      const pRows = projLabels.map((l, i) => dataRow([l, ...projYears.map(y => fmtNum(projVal(extracted, y, l)))], pWidths, i));
      children.push(new Table({ width: { size: CW, type: WidthType.DXA }, rows: [pHdr, ...pRows], borders: { insideH: BORDER_THIN, insideV: BORDER_THIN, ...BORDERS_THIN } }));
    }
    children.push(spacer(200));
  }

  // V-g: Commentary
  children.push(sectionHdr("V", "Historical Financial Analysis – Commentary"));
  narrativeBody(tpls["historical_financial"]).forEach(p => children.push(p));
  children.push(spacer(160));

  children.push(pageBreak());

  // ── VI – Projections narrative ─────────────────────────────────────────────
  addNarrative("VI", "Projections & Estimates", "projections");

  // ── VII – Key Ratios ───────────────────────────────────────────────────────
  const CAT_ORDER  = ["coverage","liquidity","solvency","profitability","efficiency","expenses","r_score","return"];
  const CAT_TITLES: Record<string, string> = {
    coverage: "Coverage Ratios", liquidity: "Liquidity Ratios",
    solvency: "Solvency Ratios", profitability: "Profitability Ratios",
    efficiency: "Efficiency & Turnover", expenses: "Expense Ratios",
    r_score: "R' Score Components", return: "Return Ratios",
  };

  const byCat: Record<string, RatioRow[]> = {};
  for (const r of ratios) {
    const c = (r as never as Record<string, unknown>)["category"] as string ?? "other";
    (byCat[c] ??= []).push(r);
  }
  const cats = [...CAT_ORDER.filter(c => byCat[c]), ...Object.keys(byCat).filter(c => !CAT_ORDER.includes(c))];

  for (const cat of cats) {
    const catR = byCat[cat];
    const allYears = [...new Set(catR.map(r => Number((r as never as Record<string, unknown>)["fiscal_year"])).filter(Boolean))].sort((a, b) => a - b);
    if (!allYears.length) continue;
    const years = allYears.slice(-5);

    const byName: Record<string, { vals: Record<string, string>; bench: string }> = {};
    for (const r of catR as never as Record<string, unknown>[]) {
      const dn = RATIO_NAMES[String(r["ratio_name"] ?? "")] ?? cap(String(r["ratio_name"] ?? ""));
      if (!byName[dn]) byName[dn] = { vals: {}, bench: "—" };
      const rawVal  = r["ratio_value"] != null ? Number(r["ratio_value"]) : null;
      const val    = rawVal != null ? rawVal.toFixed(2) : "—";
      const status = wordRatioStatus(String(r["ratio_name"] ?? ""), rawVal, r["threshold_status"] as string | null);
      const suffix = status === "green" ? " ✓" : status === "red" ? " ✗" : status === "amber" ? " !" : "";
      byName[dn].vals[String(r["fiscal_year"])] = val + suffix;
      if (r["benchmark"] != null) byName[dn].bench = String(r["benchmark"]);
    }

    const names  = Object.keys(byName);
    const benchW = 1100;
    const ratiLW = 2880;
    const yrW    = Math.floor((CW - ratiLW - benchW) / years.length);
    const rWidths = [ratiLW, ...years.map(() => yrW), benchW];
    const rHdr   = goldRow(["Ratio", ...years.map(y => `FY ${y}`), "Bench"], rWidths);
    const rRows  = names.map((n, i) => dataRow([trunc(n, 40), ...years.map(y => byName[n].vals[String(y)] ?? "—"), byName[n].bench], rWidths, i));

    children.push(sectionHdr("VII", CAT_TITLES[cat] ?? cap(cat)));
    children.push(spacer(80));
    children.push(new Table({ width: { size: CW, type: WidthType.DXA }, rows: [rHdr, ...rRows], borders: { insideH: BORDER_THIN, insideV: BORDER_THIN, ...BORDERS_THIN } }));
    children.push(spacer(160));
  }

  // VII commentary
  children.push(sectionHdr("VII", "Key Financial Ratios – Commentary"));
  narrativeBody(tpls["key_ratios"]).forEach(p => children.push(p));
  children.push(spacer(160));

  children.push(pageBreak());

  // ── VIII – Cash Flow (derived indirect method from BS + P&L) ─────────────
  {
    const cfUnit = rawUnit(extracted);
    const cfULabel = unitLabel(cfUnit);
    children.push(sectionHdr("VIII", `Cash Flow Statement (₹ ${cfULabel})`));
    children.push(spacer(80));

    const histR = extracted.filter(r => r.statement_type !== "projections");
    const histFY = [...new Set(histR.map(r => r.fiscal_year as number))].sort();
    const cfYears = histFY.slice(1); // need prior year for deltas

    function cfBs(label: string, fy: number): number | null { return liVal(extracted.filter(r => r.statement_type !== "projections"), fy, label, cfUnit); }
    function cfDelta(label: string, fy: number): number | null {
      const curr = cfBs(label, fy);
      const prev = cfBs(label, histFY[histFY.indexOf(fy) - 1]);
      if (curr === null || prev === null) return null;
      return curr - prev;
    }

    type CfRow = { label: string; summary: boolean; indent?: boolean; get: (fy: number) => number | null };
    const cfRowDefs: CfRow[] = [
      { label: "Operating Cash Flow (CFO)", summary: true, get: fy => {
        const pat = cfBs("PAT", fy), dep = cfBs("Depreciation", fy);
        const dAR = cfDelta("Trade Receivables", fy), dInv = cfDelta("Inventory", fy), dAP = cfDelta("Trade Payables", fy), dOCL = cfDelta("Other Current Liabilities", fy);
        const parts = [pat, dep, dAR != null ? -dAR : null, dInv != null ? -dInv : null, dAP, dOCL];
        if (parts.every(p => p === null)) return null;
        return parts.reduce<number>((s, v) => s + (v ?? 0), 0);
      }},
      { label: "PAT", summary: false, indent: true, get: fy => cfBs("PAT", fy) },
      { label: "Add: Depreciation", summary: false, indent: true, get: fy => cfBs("Depreciation", fy) },
      { label: "Δ Trade Receivables", summary: false, indent: true, get: fy => { const d = cfDelta("Trade Receivables", fy); return d != null ? -d : null; } },
      { label: "Δ Inventory", summary: false, indent: true, get: fy => { const d = cfDelta("Inventory", fy); return d != null ? -d : null; } },
      { label: "Δ Trade Payables", summary: false, indent: true, get: fy => cfDelta("Trade Payables", fy) },
      { label: "Investing Cash Flow (CFI)", summary: true, get: fy => {
        const dep = cfBs("Depreciation", fy), dFA = cfDelta("Fixed Assets (Net)", fy);
        if (dep === null && dFA === null) return null;
        return -((dFA ?? 0) + (dep ?? 0));
      }},
      { label: "Capex (approx.)", summary: false, indent: true, get: fy => { const dep = cfBs("Depreciation", fy), dFA = cfDelta("Fixed Assets (Net)", fy); if (dep === null && dFA === null) return null; return -((dFA ?? 0) + (dep ?? 0)); } },
      { label: "Financing Cash Flow (CFF)", summary: true, get: fy => {
        const dLT = cfDelta("Long Term Borrowings", fy), dST = cfDelta("Short Term Borrowings", fy);
        if (dLT === null && dST === null) return null;
        return (dLT ?? 0) + (dST ?? 0);
      }},
      { label: "Δ Long Term Borrowings", summary: false, indent: true, get: fy => cfDelta("Long Term Borrowings", fy) },
      { label: "Δ Short Term Borrowings", summary: false, indent: true, get: fy => cfDelta("Short Term Borrowings", fy) },
      { label: "Net Change in Cash", summary: true, get: fy => {
        const cfo = cfRowDefs[0].get(fy), cfi = cfRowDefs[6].get(fy), cff = cfRowDefs[8].get(fy);
        if (cfo === null && cfi === null && cff === null) return null;
        return (cfo ?? 0) + (cfi ?? 0) + (cff ?? 0);
      }},
    ];

    if (cfYears.length >= 1) {
      children.push(new Paragraph({ children: [new TextRun({ text: "⚙ Derived – Indirect Method · computed from BS + P&L · actual cash flow not uploaded", color: "92400E", size: SZ.sm, font: "Calibri", italics: true })], shading: { type: ShadingType.CLEAR, color: "auto", fill: "FFF8E1" }, spacing: { before: 0, after: 80 }, indent: { left: 80, right: 80 } }));
      const labelW2 = 3200;
      const valW2 = Math.floor((CW - labelW2) / cfYears.length);
      const cfWidths = [labelW2, ...cfYears.map(() => valW2)];
      const cfHdr = goldRow(["Line Item", ...cfYears.map(y => `FY${y}`)], cfWidths);
      const cfDocRows = cfRowDefs
        .filter(row => cfYears.some(y => row.get(y) !== null))
        .map((row, i) => {
          const bg = row.summary ? "EBF3FD" : (i % 2 === 0 ? CLR.white : CLR.altRow);
          return new TableRow({ children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: row.label, bold: row.summary, color: row.summary ? CLR.navy : CLR.body, size: SZ.base, font: "Calibri" })], spacing: { before: 50, after: 50 }, indent: { left: row.indent ? 200 : 80 } })], shading: { type: ShadingType.CLEAR, color: "auto", fill: bg }, width: { size: labelW2, type: WidthType.DXA }, borders: BORDERS_THIN }),
            ...cfYears.map(y => {
              const v = row.get(y);
              const txt = v !== null ? v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
              return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: txt, bold: row.summary, color: v !== null && v < 0 ? CLR.red : (row.summary ? CLR.navy : CLR.body), size: SZ.base, font: "Calibri" })], alignment: AlignmentType.RIGHT, spacing: { before: 50, after: 50 }, indent: { right: 80 } })], shading: { type: ShadingType.CLEAR, color: "auto", fill: bg }, width: { size: valW2, type: WidthType.DXA }, borders: BORDERS_THIN });
            }),
          ]});
        });
      children.push(new Table({ width: { size: CW, type: WidthType.DXA }, rows: [cfHdr, ...cfDocRows], borders: { insideH: BORDER_THIN, insideV: BORDER_THIN, ...BORDERS_THIN } }));
    }
    narrativeBody(tpls["cash_flow"]).forEach(p => children.push(p));
    children.push(spacer(160));
  }

  // ── IX – Due Diligence ────────────────────────────────────────────────────
  addNarrative("IX",   "Due Diligence Excerpts","due_diligence");

  // ── X – Risk Matrix ────────────────────────────────────────────────────────
  children.push(sectionHdr("X", "Risk Assessment & Mitigation"));
  children.push(spacer(80));
  const risks = ic.risks ?? [];
  if (!risks.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: "No risks entered. Add them in the IC Note tab.", color: CLR.muted, size: SZ.base, font: "Calibri", italics: true })], spacing: { before: 80, after: 80 } }));
  } else {
    const rskW = [1800, 2700, 3780, 1000] as number[];
    const rskHdr = goldRow(["Category", "Risk", "Mitigant", "Sev."], rskW);
    const rskRows = risks.map((r, i) => {
      const bg = i % 2 === 0 ? CLR.white : CLR.altRow;
      const sevColor = r.severity === "HIGH" ? CLR.red : r.severity === "MEDIUM" ? CLR.amber : CLR.blue;
      return new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: trunc(r.category, 25), color: CLR.body, size: SZ.base, font: "Calibri" })], spacing: { before: 60, after: 60 }, indent: { left: 80 } })], shading: { type: ShadingType.CLEAR, color: "auto", fill: bg }, width: { size: rskW[0], type: WidthType.DXA }, borders: BORDERS_THIN }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: r.risk ?? "—", color: CLR.body, size: SZ.base, font: "Calibri" })], spacing: { before: 60, after: 60 }, indent: { left: 80 } })], shading: { type: ShadingType.CLEAR, color: "auto", fill: bg }, width: { size: rskW[1], type: WidthType.DXA }, borders: BORDERS_THIN }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: r.mitigant ?? "—", color: CLR.body, size: SZ.base, font: "Calibri" })], spacing: { before: 60, after: 60 }, indent: { left: 80 } })], shading: { type: ShadingType.CLEAR, color: "auto", fill: bg }, width: { size: rskW[2], type: WidthType.DXA }, borders: BORDERS_THIN }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: (r.severity ?? "—").slice(0, 3), bold: true, color: sevColor, size: SZ.base, font: "Calibri" })], alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60 } })], shading: { type: ShadingType.CLEAR, color: "auto", fill: bg }, width: { size: rskW[3], type: WidthType.DXA }, borders: BORDERS_THIN }),
        ],
      });
    });
    children.push(new Table({ width: { size: CW, type: WidthType.DXA }, rows: [rskHdr, ...rskRows], borders: { insideH: BORDER_THIN, insideV: BORDER_THIN, ...BORDERS_THIN } }));
  }
  children.push(spacer(200));

  // ── XI – Visit Report (checklist + photos + narrative) ──────────────────────
  {
    children.push(sectionHdr("XI", "Visit Report"));
    const vr = ic.visit_report;
    const cl = vr?.checklist ?? {};
    const checkEntries: [string, string][] = [
      ["Banker Reference",        cl.banker_reference?.status ?? "—"],
      ["Vendor / Supplier Check", cl.vendor_check?.status ?? "—"],
      ["Customer Reference",      cl.customer_reference?.status ?? "—"],
      ["Site Visit",              cl.site_visit?.status ?? "—"],
    ];
    const hasChecklist = checkEntries.some(([, s]) => s !== "—");

    if (hasChecklist) {
      const chkW = [2500, 1400, 1200, 4980] as number[];
      const chkHdr = goldRow(["Check", "Source", "Status", "Findings"], chkW);
      const chkRows = [
        { key: "banker_reference",   label: "Banker Reference",        item: cl.banker_reference },
        { key: "vendor_check",       label: "Vendor / Supplier Check", item: cl.vendor_check },
        { key: "customer_reference", label: "Customer Reference",       item: cl.customer_reference },
        { key: "site_visit",         label: "Site Visit",               item: cl.site_visit },
      ].map(({ label, item }, i) => {
        const bg = i % 2 === 0 ? CLR.white : CLR.altRow;
        const status = item?.status ?? "pending";
        const statusColor = status === "done" ? CLR.green : status === "na" ? CLR.muted : CLR.amber;
        const statusLabel = status === "done" ? "Done" : status === "na" ? "N/A" : "Pending";
        return new TableRow({ children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, color: CLR.body, size: SZ.base, font: "Calibri" })], spacing: { before: 60, after: 60 }, indent: { left: 80 } })], shading: { type: ShadingType.CLEAR, color: "auto", fill: bg }, width: { size: chkW[0], type: WidthType.DXA }, borders: BORDERS_THIN }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item?.source || "—", color: CLR.muted, size: SZ.base, font: "Calibri" })], spacing: { before: 60, after: 60 }, indent: { left: 80 } })], shading: { type: ShadingType.CLEAR, color: "auto", fill: bg }, width: { size: chkW[1], type: WidthType.DXA }, borders: BORDERS_THIN }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: statusLabel, bold: true, color: statusColor, size: SZ.base, font: "Calibri" })], spacing: { before: 60, after: 60 }, alignment: AlignmentType.CENTER })], shading: { type: ShadingType.CLEAR, color: "auto", fill: bg }, width: { size: chkW[2], type: WidthType.DXA }, borders: BORDERS_THIN }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: item?.notes || "—", color: CLR.body, size: SZ.base, font: "Calibri" })], spacing: { before: 60, after: 60 }, indent: { left: 80 } })], shading: { type: ShadingType.CLEAR, color: "auto", fill: bg }, width: { size: chkW[3], type: WidthType.DXA }, borders: BORDERS_THIN }),
        ]});
      });
      children.push(spacer(80));
      children.push(new Table({ width: { size: CW, type: WidthType.DXA }, rows: [chkHdr, ...chkRows], borders: { insideH: BORDER_THIN, insideV: BORDER_THIN, ...BORDERS_THIN } }));
    }

    if (vr?.overall_notes?.trim()) {
      children.push(new Paragraph({ children: [new TextRun({ text: "SITE VISIT OBSERVATIONS", bold: true, color: CLR.muted, size: SZ.sm, font: "Calibri", characterSpacing: 40 })], spacing: { before: 120, after: 50 } }));
      children.push(new Paragraph({ children: [new TextRun({ text: vr.overall_notes, color: CLR.body, size: SZ.base, font: "Calibri" })], shading: { type: ShadingType.CLEAR, color: "auto", fill: CLR.altRow }, spacing: { before: 60, after: 80 }, indent: { left: 120 } }));
    }

    // Photos embedded from photoBlobs
    const imgBlobs = photoBlobs.filter(p => /image\//i.test(p.mimeType));
    if (imgBlobs.length > 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: `SITE PHOTOS (${imgBlobs.length})`, bold: true, color: CLR.muted, size: SZ.sm, font: "Calibri", characterSpacing: 40 })], spacing: { before: 120, after: 80 } }));
      for (const blob of imgBlobs) {
        try {
          const ext = blob.mimeType.includes("png") ? "png" : "jpg";
          children.push(new Paragraph({
            children: [new ImageRun({ type: ext as "png" | "jpg", data: blob.data, transformation: { width: 400, height: 260 } })],
            spacing: { before: 80, after: 40 },
          }));
          children.push(new Paragraph({ children: [new TextRun({ text: blob.name, color: CLR.muted, size: SZ.sm, font: "Calibri", italics: true })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: 80 } }));
        } catch { /* skip corrupt image */ }
      }
    }

    narrativeBody(tpls["visit_reference"]).forEach(p => children.push(p));
    children.push(spacer(160));
  }

  addNarrative("XII",  "Executive Team Recommendation", "exec_recommendation");
  addNarrative("XIII", "Specific Product Requirements",  "product_specifics");
  addNarrative("XIV",  "Triangulation Analysis",         "triangulation_analysis");

  children.push(pageBreak());

  // ── XV – Conditions Precedent ──────────────────────────────────────────────
  children.push(sectionHdr("XV", "Conditions Precedent"));
  children.push(spacer(80));
  const cps = ic.conditions_precedent ?? [];
  if (!cps.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: "No conditions entered. Add them in the IC Note tab.", color: CLR.muted, size: SZ.base, font: "Calibri", italics: true })], spacing: { before: 80, after: 80 } }));
  } else {
    cps.forEach((cp, i) => {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${String(i + 1).padStart(2, "0")}.  `, bold: true, color: CLR.navy, size: SZ.base, font: "Georgia" }),
          new TextRun({ text: cp, color: CLR.body, size: SZ.base, font: "Calibri" }),
        ],
        spacing: { before: 80, after: 80 },
        indent: { left: convertInchesToTwip(0.2) },
      }));
    });
  }
  children.push(spacer(200));

  // ── XVI – SWOT ─────────────────────────────────────────────────────────────
  children.push(sectionHdr("XVI", "SWOT Analysis"));
  children.push(spacer(80));

  if (!ic.swot) {
    children.push(new Paragraph({ children: [new TextRun({ text: "SWOT not entered. Add it in the IC Note tab.", color: CLR.muted, size: SZ.base, font: "Calibri", italics: true })], spacing: { before: 80, after: 80 } }));
  } else {
    const swot = ic.swot;
    const halfW = Math.floor(CW / 2);
    const swotGroups = [
      [{ label: "STRENGTHS", items: swot.strengths ?? [], fill: "F0FDF4", color: CLR.green },
       { label: "WEAKNESSES", items: swot.weaknesses ?? [], fill: "FEF2F2", color: CLR.red }],
      [{ label: "OPPORTUNITIES", items: swot.opportunities ?? [], fill: "EFF6FF", color: CLR.blue },
       { label: "THREATS", items: swot.threats ?? [], fill: "FFFBEB", color: "92400E" }],
    ];
    for (const row of swotGroups) {
      const tRow = new TableRow({
        children: row.map(q => new TableCell({
          children: [
            new Paragraph({ children: [new TextRun({ text: q.label, bold: true, color: q.color, size: SZ.md, font: "Georgia", characterSpacing: 60 })], spacing: { before: 80, after: 60 }, indent: { left: 100 } }),
            ...(q.items as string[]).map(it => new Paragraph({
              children: [
                new TextRun({ text: "•  ", color: q.color, bold: true, size: SZ.base, font: "Calibri" }),
                new TextRun({ text: it, color: CLR.body, size: SZ.base, font: "Calibri" }),
              ],
              spacing: { before: 40, after: 40 },
              indent: { left: 120 },
            })),
            ...(q.items.length === 0 ? [new Paragraph({ children: [new TextRun({ text: "—", color: CLR.muted, size: SZ.base, font: "Calibri" })], spacing: { before: 40, after: 40 }, indent: { left: 120 } })] : []),
          ],
          shading: { type: ShadingType.CLEAR, color: "auto", fill: q.fill },
          width: { size: halfW, type: WidthType.DXA },
          borders: BORDERS_THIN,
          margins: { top: 80, bottom: 100, left: 100, right: 100 },
        })),
      });
      children.push(new Table({ width: { size: CW, type: WidthType.DXA }, rows: [tRow], borders: BORDERS_THIN }));
    }
  }
  children.push(spacer(200));

  children.push(pageBreak());

  // ── Annexures header ───────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [new TextRun({ text: "Annexures", color: CLR.gold, bold: true, size: 52, font: "Georgia" })],
    shading: { type: ShadingType.CLEAR, color: "auto", fill: CLR.navy },
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    indent: { left: convertInchesToTwip(0.15), right: convertInchesToTwip(0.15) },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: clientName, color: CLR.white, size: SZ.xl, font: "Calibri" })],
    shading: { type: ShadingType.CLEAR, color: "auto", fill: CLR.navy },
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    indent: { left: convertInchesToTwip(0.15), right: convertInchesToTwip(0.15) },
  }));
  children.push(spacer(200));
  children.push(sectionHdr(null, "Site Visit Pictures"));
  children.push(new Paragraph({ children: [new TextRun({ text: "Site visit photos to be inserted here.", color: CLR.muted, size: SZ.base, font: "Calibri", italics: true })], spacing: { before: 80, after: 80 } }));
  children.push(spacer(160));
  children.push(sectionHdr(null, "Data Visualization — Sourced from Accumn"));
  children.push(new Paragraph({ children: [new TextRun({ text: "Data visualization outputs from Accumn will appear here.", color: CLR.muted, size: SZ.base, font: "Calibri", italics: true })], spacing: { before: 80, after: 80 } }));
  children.push(spacer(160));
  children.push(sectionHdr(null, "IC Approval Conditions"));
  const conditions = (ic as Record<string, unknown>)["ic_approval_conditions"] as string | undefined;
  if (conditions?.trim()) {
    children.push(new Paragraph({ children: [new TextRun({ text: conditions, color: CLR.body, size: SZ.base, font: "Calibri" })], spacing: { before: 80, after: 80 } }));
  } else {
    children.push(new Paragraph({ children: [new TextRun({ text: "IC approval conditions to be entered.", color: CLR.muted, size: SZ.base, font: "Calibri", italics: true })], spacing: { before: 80, after: 80 } }));
  }
  children.push(spacer(160));
  children.push(sectionHdr(null, "Rehbar Investment Approval Policies"));
  children.push(spacer(200));

  // ── Closing ────────────────────────────────────────────────────────────────
  children.push(pageBreak());
  children.push(new Paragraph({
    children: [new TextRun({ text: "REHBAR FINANCIAL SERVICES", color: CLR.gold, bold: true, size: SZ.xxl, font: "Georgia", characterSpacing: 100 })],
    shading: { type: ShadingType.CLEAR, color: "auto", fill: CLR.navy },
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
  }));
  children.push(spacer(400));
  children.push(new Paragraph({
    children: [new TextRun({ text: "This document is strictly confidential and prepared for internal Investment Committee use only.", color: CLR.body, size: SZ.md, font: "Calibri" })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 160 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: clientName, color: CLR.navy, bold: true, size: SZ.xl, font: "Georgia" })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 160 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "© Rehbar Financial Services  ·  rehbar.co.in", color: CLR.muted, size: SZ.base, font: "Calibri" })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
  }));

  // ── Assemble document ──────────────────────────────────────────────────────
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(0.75),
            bottom: convertInchesToTwip(0.75),
            left: convertInchesToTwip(0.75),
            right: convertInchesToTwip(0.75),
          },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({ text: `IC Deck  —  ${clientName}`, color: CLR.muted, size: SZ.sm, font: "Calibri", italics: true })],
            alignment: AlignmentType.RIGHT,
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: "Confidential – Rehbar Financial Services", color: CLR.muted, size: SZ.sm, font: "Calibri", italics: true }),
              new TextRun({ text: "\t", size: SZ.sm }),
              new TextRun({ children: [PageNumber.CURRENT], size: SZ.sm, font: "Calibri", color: CLR.muted }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: convertInchesToTwip(7) }],
          })],
        }),
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  const safeName = clientName.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 40);
  a.href     = url;
  a.download = `IC_Deck_${safeName}_${new Date().toISOString().slice(0, 10)}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
