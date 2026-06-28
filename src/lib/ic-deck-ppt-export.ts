import PptxGenJS from "pptxgenjs";
import type { IcNoteShape } from "@/tabs/case/ic/ICNoteDocument";
import type { CaseRow, ExtractedRow, RatioRow } from "@/features/case/types";

type Slide = ReturnType<PptxGenJS["addSlide"]>;

interface LineItem {
  label: string;
  value: number | null;
  override_value?: number | null;
}

interface SectionTemplate {
  headline?: string;
  bullets?: string[];
  flags?: string[];
}

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  navy:   "0F1B2D",
  gold:   "F5C518",
  white:  "FFFFFF",
  body:   "1C1C1E",
  muted:  "888888",
  altRow: "F5F5F0",
  border: "E5E5E0",
  amber:  "D97706",
  navy_s: "#0F1B2D",
  gold_s: "#F5C518",
} as const;

const W     = 13.33;
const H     = 7.5;
const HDR_H = 0.64;
const FTR_H = 0.36;
const MX    = 0.3;

const RATIO_NAMES: Record<string, string> = {
  dscr: "DSCR", icr: "ICR", fccr: "FCCR",
  current_ratio: "Current Ratio", quick_ratio: "Quick Ratio", cash_ratio: "Cash Ratio",
  debt_equity: "D/E Ratio", debt_ebitda: "Debt / EBITDA", leverage: "Leverage",
  gross_margin: "Gross Margin %", ebitda_margin: "EBITDA Margin %", pat_margin: "PAT Margin %",
  net_margin: "Net Margin %", roe: "ROE", roce: "ROCE", ronw: "RONW",
  inventory_days: "Inventory Days", debtor_days: "Debtor Days", creditor_days: "Creditor Days",
  asset_turnover: "Asset Turnover",
};

// ── Tiny helpers ──────────────────────────────────────────────────────────────
function trunc(s: string | null | undefined, n: number): string {
  const str = s ?? "";
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
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
  if (u.includes("crore"))  return "Crores";
  if (u.includes("million")) return "Millions";
  return "Lakhs";
}

async function fetchLogo(): Promise<string | null> {
  try {
    const res = await fetch("/Rehbar_logo.png");
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror   = () => reject(null);
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}

// ── Slide shell ───────────────────────────────────────────────────────────────
function addHeader(s: Slide, roman: string | null, title: string, logo: string | null): void {
  s.addShape("rect" as never, {
    x: 0, y: 0, w: W, h: HDR_H,
    fill: { color: C.navy }, line: { color: C.navy },
  } as never);

  const logoW = 1.72;
  const textW = W - 0.3 - (logo ? logoW + 0.25 : 0.1);

  const parts: PptxGenJS.TextProps[] = [];
  if (roman) parts.push({ text: roman + "  ", options: { color: C.gold, bold: true, fontSize: 14, fontFace: "Georgia" } });
  parts.push({ text: title, options: { color: C.white, bold: true, fontSize: 13, fontFace: "Georgia" } });

  s.addText(parts, { x: 0.3, y: 0, w: textW, h: HDR_H, valign: "middle" } as never);

  if (logo) {
    const lH = 0.38;
    const lW = lH * 3.85;
    s.addImage({ data: logo, x: W - lW - 0.18, y: (HDR_H - lH) / 2, w: lW, h: lH } as never);
  }
}

function addFooter(s: Slide, pageNum: number): void {
  s.addShape("rect" as never, {
    x: MX, y: H - FTR_H, w: W - MX * 2, h: 0.01,
    fill: { color: "E5E5E0" }, line: { color: "E5E5E0" },
  } as never);
  s.addText("Confidential – Rehbar Financial Services", {
    x: MX, y: H - FTR_H + 0.05, w: W - 2, h: FTR_H - 0.08,
    fontSize: 8, color: C.muted, fontFace: "Calibri", italic: true, valign: "middle",
  } as never);
  s.addText(String(pageNum), {
    x: W - 1.2, y: H - FTR_H + 0.05, w: 0.9, h: FTR_H - 0.08,
    fontSize: 8, color: C.muted, fontFace: "Calibri", align: "right", valign: "middle",
  } as never);
}

function deckSlide(pptx: PptxGenJS, roman: string | null, title: string, logo: string | null, pg: number): Slide {
  const s = pptx.addSlide();
  s.background = { color: C.white };
  addHeader(s, roman, title, logo);
  addFooter(s, pg);
  return s;
}

// ── Gold-header table ─────────────────────────────────────────────────────────
function addGoldTable(
  s: Slide,
  y: number,
  headers: string[],
  rows: string[][],
  colW: number[],
  rowH = 0.28,
): void {
  if (!rows.length) return;

  const headerRow = headers.map((h, ci) => ({
    text: h,
    options: {
      bold: true, fontSize: 10, color: C.body, fill: { color: C.gold },
      fontFace: "Calibri", align: (ci === 0 ? "left" : "right") as "left" | "right", wrap: true,
    },
  }));

  const dataRows = rows.map((row, ri) =>
    row.map((cell, ci) => ({
      text: cell,
      options: {
        fontSize: 10, color: C.body,
        fill: { color: ri % 2 === 0 ? C.white : C.altRow },
        fontFace: "Calibri",
        align: (ci === 0 ? "left" : "right") as "left" | "right",
        wrap: true,
      },
    })),
  );

  s.addTable([headerRow, ...dataRows] as never, {
    x: MX, y, w: W - MX * 2, rowH,
    border: { pt: 0.5, color: C.border },
  } as never);
}

// ── Narrative body ────────────────────────────────────────────────────────────
function addNarrative(s: Slide, tpl: SectionTemplate | undefined): void {
  if (!tpl) {
    s.addText("Section not yet generated. Click Generate in the IC Deck tab to fill this section.", {
      x: MX + 0.2, y: HDR_H + 0.35, w: W - MX * 2 - 0.4, h: 0.5,
      fontSize: 10, color: C.muted, fontFace: "Calibri", italic: true,
    } as never);
    return;
  }

  let y = HDR_H + 0.22;

  if (tpl.headline) {
    s.addText(tpl.headline, {
      x: MX + 0.2, y, w: W - MX * 2 - 0.4, h: 0.42,
      fontSize: 13, color: C.body, fontFace: "Georgia", italic: true,
    } as never);
    y += 0.48;
  }

  for (const b of tpl.bullets ?? []) {
    s.addText([
      { text: "•  ", options: { color: C.navy_s, bold: true, fontSize: 11, fontFace: "Calibri" } },
      { text: trunc(b, 240), options: { color: C.body, fontSize: 11, fontFace: "Calibri" } },
    ], { x: MX + 0.35, y, w: W - MX * 2 - 0.7, h: 0.34, valign: "top" } as never);
    y += 0.38;
    if (y > H - FTR_H - 0.2) break;
  }

  for (const f of tpl.flags ?? []) {
    s.addText([
      { text: "⚠  ", options: { color: C.amber, bold: true, fontSize: 11, fontFace: "Calibri" } },
      { text: trunc(f, 200), options: { color: C.body, fontSize: 11, fontFace: "Calibri" } },
    ], { x: MX + 0.35, y, w: W - MX * 2 - 0.7, h: 0.34, valign: "top" } as never);
    y += 0.38;
    if (y > H - FTR_H - 0.2) break;
  }
}

// ── Financial data helpers ────────────────────────────────────────────────────
function histFyYears(extracted: ExtractedRow[]): number[] {
  return [...new Set(
    extracted.filter(r => r.statement_type !== "projections" && r.fiscal_year != null)
      .map(r => r.fiscal_year as number),
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
      const v = item.override_value !== undefined && item.override_value !== null
        ? item.override_value : item.value;
      return scaleUnit(v, unit);
    }
  }
  return null;
}

const PROJ_ALIASES: Record<string, string[]> = {
  "Projected Turnover":    ["Projected Turnover", "Projected Revenue", "Revenue", "Total Income", "Turnover", "Net Sales"],
  "Projected EBITDA":      ["Projected EBITDA", "EBITDA", "Projected Gross Profit", "Gross Profit"],
  "Projected PAT":         ["Projected PAT", "Projected Net Profit", "PAT", "Net Profit"],
  "Projected Net Worth":   ["Projected Net Worth", "Net Worth", "Shareholders Equity", "Total Equity"],
  "Projected Total Debt":  ["Projected Total Debt", "Total Debt"],
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

function finRows(extracted: ExtractedRow[], labels: string[], shownYears: number[], unit: string | null): string[][] {
  return labels
    .map(label => {
      const vals = shownYears.map(y => liVal(extracted, y, label, unit));
      if (vals.every(v => v === null)) return null;
      const last = vals[vals.length - 1];
      const prev = vals[vals.length - 2] ?? null;
      let yoy = "—";
      if (last !== null && prev !== null && prev !== 0) {
        const pct = ((last - prev) / Math.abs(prev)) * 100;
        yoy = `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
      }
      return [label, ...vals.map(fmtNum), yoy];
    })
    .filter(Boolean) as string[][];
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateIcDeckPpt(params: {
  cc: CaseRow;
  ic: IcNoteShape;
  extracted: ExtractedRow[];
  ratios: RatioRow[];
  company?: Record<string, string | null> | null;
  directors?: Record<string, string | null>[] | null;
}): Promise<void> {
  const { cc, ic, extracted, ratios, company, directors } = params;
  const clientName = cc.client_name ?? "Borrower";
  const logo = await fetchLogo();
  const tpls = (ic.section_templates ?? {}) as Record<string, SectionTemplate>;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Rehbar Credit Terminal";
  pptx.company = "Rehbar Financial Services";
  pptx.title = `IC Deck — ${clientName}`;

  let pg = 1;

  // ── 1. Cover ──────────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: C.white };

    // Navy top bar
    s.addShape("rect" as never, { x: 0, y: 0, w: W, h: 1.1, fill: { color: C.navy }, line: { color: C.navy } } as never);
    s.addShape("rect" as never, { x: 0, y: 1.1, w: W, h: 0.05, fill: { color: C.gold }, line: { color: C.gold } } as never);

    if (logo) s.addImage({ data: logo, x: 0.35, y: (1.1 - 0.44) / 2, w: 1.7, h: 0.44 } as never);

    s.addText("Investment Committee Deck", {
      x: W - 4.5, y: 0.35, w: 4.2, h: 0.36,
      fontSize: 11, color: C.gold, fontFace: "Calibri", align: "right",
    } as never);

    // Client name
    s.addText(clientName, {
      x: MX, y: 1.9, w: W - MX * 2, h: 1.0,
      fontSize: 30, color: C.navy, bold: true, fontFace: "Georgia", align: "center",
    } as never);

    const prodLabel = cc.product_type ? cap(cc.product_type) : "Credit Facility";
    s.addText(prodLabel, {
      x: MX, y: 3.05, w: W - MX * 2, h: 0.48,
      fontSize: 16, color: C.muted, fontFace: "Calibri", align: "center",
    } as never);

    const amt  = cc.deal_amount != null ? `₹ ${Number(cc.deal_amount).toFixed(2)} Cr` : "";
    const date = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    s.addText([amt, date].filter(Boolean).join("  ·  "), {
      x: MX, y: 3.65, w: W - MX * 2, h: 0.38,
      fontSize: 12, color: C.muted, fontFace: "Calibri", align: "center",
    } as never);

    // Gold footer bar
    s.addShape("rect" as never, { x: 0, y: H - 0.28, w: W, h: 0.28, fill: { color: C.gold }, line: { color: C.gold } } as never);
    s.addText("Confidential – Rehbar Financial Services", {
      x: MX, y: H - 0.27, w: W - MX * 2, h: 0.27,
      fontSize: 8.5, color: C.navy, bold: true, fontFace: "Calibri", align: "center", valign: "middle",
    } as never);

    pg++;
  }

  // ── 2. TOC ────────────────────────────────────────────────────────────────
  {
    const s = deckSlide(pptx, null, "Table of Contents", logo, pg);

    const items = [
      ["I", "Executive Summary"],            ["II",   "Client & Promoter Profile"],
      ["III", "Proposed Investment Struct."], ["IV",   "Rehbar Funding History"],
      ["V", "Historical Financial Analysis"],["VI",   "Projections & Estimates"],
      ["VII", "Key Financial Ratios"],        ["VIII", "Cash Flow Statement"],
      ["IX", "Due Diligence Excerpts"],       ["X",    "Risk Assessment & Mitigation"],
      ["XI", "Visit Report"],                 ["XII",  "Executive Team Recommendation"],
      ["XIII", "Specific Product Requirements"],["XIV","Triangulation Analysis"],
      ["XV", "Conditions Precedent"],         ["XVI",  "SWOT Analysis"],
    ];

    const hdr = ["#", "Section", "#", "Section"].map(h => ({
      text: h,
      options: { bold: true, fontSize: 10, color: C.body, fill: { color: C.gold }, fontFace: "Calibri",
        align: (h === "#" ? "center" : "left") as "center" | "left" },
    }));

    const dataRows = [];
    for (let i = 0; i < items.length; i += 2) {
      const L = items[i], R = items[i + 1];
      const bg = Math.floor(i / 2) % 2 === 0 ? C.white : C.altRow;
      dataRows.push([
        { text: L[0], options: { fontSize: 10, bold: true, color: C.navy, fill: { color: bg }, fontFace: "Calibri", align: "center" as const } },
        { text: L[1], options: { fontSize: 10, color: C.body, fill: { color: bg }, fontFace: "Calibri" } },
        { text: R ? R[0] : "", options: { fontSize: 10, bold: true, color: C.navy, fill: { color: bg }, fontFace: "Calibri", align: "center" as const } },
        { text: R ? R[1] : "", options: { fontSize: 10, color: C.body, fill: { color: bg }, fontFace: "Calibri" } },
      ]);
    }

    s.addTable([hdr, ...dataRows] as never, {
      x: MX, y: HDR_H + 0.2, w: W - MX * 2, rowH: 0.34,
      border: { pt: 0.5, color: C.border },
      colW: [0.65, 5.7, 0.65, 5.7],
    } as never);

    pg++;
  }

  // ── 3. Deal Summary ───────────────────────────────────────────────────────
  {
    const s = deckSlide(pptx, null, "Deal Summary", logo, pg);

    const hdr = ["Parameter", "Value", "Parameter", "Value"].map(h => ({
      text: h,
      options: { bold: true, fontSize: 10, color: C.body, fill: { color: C.gold }, fontFace: "Calibri" },
    }));

    const pairs: [string, string, string, string][] = [
      ["Borrower", trunc(clientName, 50), "Case Reference", cc.case_code ?? "—"],
      ["Product", trunc(cc.product_type ? cap(cc.product_type) : "—", 40), "Deal Amount", cc.deal_amount != null ? `₹ ${Number(cc.deal_amount).toFixed(2)} Cr` : "—"],
      ["Tenure", cc.tenure_months != null ? `${cc.tenure_months} Months` : "—", "Expected IRR", cc.expected_irr != null ? `${Number(cc.expected_irr)}% p.a.` : "—"],
      ["Industry", trunc(cc.industry ?? "—", 38), "Legal Constitution", trunc(cc.legal_constitution ?? "—", 38)],
      ["End Use", trunc(cc.end_use ?? "—", 55), "Collateral", trunc(cc.collateral_summary ?? "—", 55)],
    ];

    const tRows = pairs.map((row, ri) => {
      const bg = ri % 2 === 0 ? C.white : C.altRow;
      return [
        { text: row[0], options: { bold: true, fontSize: 10.5, color: C.navy, fill: { color: bg }, fontFace: "Calibri", wrap: true } },
        { text: row[1], options: { fontSize: 10.5, color: C.body, fill: { color: bg }, fontFace: "Calibri", wrap: true } },
        { text: row[2], options: { bold: true, fontSize: 10.5, color: C.navy, fill: { color: bg }, fontFace: "Calibri", wrap: true } },
        { text: row[3], options: { fontSize: 10.5, color: C.body, fill: { color: bg }, fontFace: "Calibri", wrap: true } },
      ];
    });

    s.addTable([hdr, ...tRows] as never, {
      x: MX, y: HDR_H + 0.22, w: W - MX * 2, rowH: 0.72,
      border: { pt: 0.75, color: C.border },
      colW: [2.2, 4.1, 2.2, 4.1],
    } as never);

    pg++;
  }

  // ── 4. Company Profile ────────────────────────────────────────────────────
  const SKIP_KEYS = new Set(["id","created_at","updated_at","case_id","org_id","company_id","user_id","vector","embedding","search_vector"]);

  if (company && Object.keys(company).length > 0) {
    const entries = Object.entries(company)
      .filter(([k, v]) => !SKIP_KEYS.has(k) && v != null && String(v).trim())
      .map(([k, v]) => [cap(k), String(v)]);

    if (entries.length) {
      const s = deckSlide(pptx, null, "Company Profile", logo, pg);
      const hdr = [
        { text: "Field",   options: { bold: true, fontSize: 10, color: C.body, fill: { color: C.gold }, fontFace: "Calibri" } },
        { text: "Details", options: { bold: true, fontSize: 10, color: C.body, fill: { color: C.gold }, fontFace: "Calibri" } },
      ];
      const tRows = entries.map(([label, value], ri) => {
        const bg = ri % 2 === 0 ? C.white : C.altRow;
        return [
          { text: label, options: { bold: true, fontSize: 10, color: C.navy, fill: { color: bg }, fontFace: "Calibri", wrap: true } },
          { text: trunc(value, 120), options: { fontSize: 10, color: C.body, fill: { color: bg }, fontFace: "Calibri", wrap: true } },
        ];
      });
      s.addTable([hdr, ...tRows] as never, {
        x: MX, y: HDR_H + 0.18, w: W - MX * 2, rowH: 0.3,
        border: { pt: 0.5, color: C.border }, colW: [3.0, 9.7],
      } as never);
      pg++;
    }
  }

  // ── 5. Directors ──────────────────────────────────────────────────────────
  if (directors && directors.length > 0) {
    const s = deckSlide(pptx, null, "Corporate Governance — Directors", logo, pg);
    const PREF = ["name","din","designation","appointed","shareholding","age"];
    const allKeys = [...new Set(directors.flatMap(d => Object.keys(d)))].filter(k => !SKIP_KEYS.has(k));
    const cols = [...PREF.filter(k => allKeys.includes(k)), ...allKeys.filter(k => !PREF.includes(k))].slice(0, 6);
    const firstW = 3.0;
    const restW  = (W - MX * 2 - firstW) / Math.max(cols.length - 1, 1);

    const hdr = cols.map((k, ci) => ({
      text: cap(k),
      options: { bold: true, fontSize: 10, color: C.body, fill: { color: C.gold }, fontFace: "Calibri",
        align: (ci === 0 ? "left" : "center") as "left" | "center" },
    }));
    const dRows = directors.map((d, ri) =>
      cols.map((k, ci) => ({
        text: trunc(String(d[k] ?? "—"), 40),
        options: { fontSize: 10, color: C.body, fill: { color: ri % 2 === 0 ? C.white : C.altRow },
          fontFace: "Calibri", align: (ci === 0 ? "left" : "center") as "left" | "center", wrap: true },
      })),
    );
    s.addTable([hdr, ...dRows] as never, {
      x: MX, y: HDR_H + 0.18, w: W - MX * 2, rowH: 0.32,
      border: { pt: 0.5, color: C.border },
      colW: [firstW, ...cols.slice(1).map(() => restW)],
    } as never);
    pg++;
  }

  // ── Sections I–IV (narrative) ─────────────────────────────────────────────
  const earlyNarrative = [
    { id: "executive_summary",      roman: "I",   title: "Executive Summary" },
    { id: "client_promoter",        roman: "II",  title: "Client & Promoter Profile" },
    { id: "investment_structure",   roman: "III", title: "Proposed Investment Structure" },
    { id: "rehbar_funding_history", roman: "IV",  title: "Rehbar Funding History" },
  ];

  for (const sec of earlyNarrative) {
    const s = deckSlide(pptx, sec.roman, sec.title, logo, pg);

    if (sec.id === "investment_structure") {
      // Show deal table instead of narrative
      const dealPairs: [string, string][] = [
        ["Product Type",       cc.product_type ? cap(cc.product_type) : "—"],
        ["Deal Amount",        cc.deal_amount != null ? `₹ ${Number(cc.deal_amount).toFixed(2)} Cr` : "—"],
        ["Tenure",             cc.tenure_months != null ? `${cc.tenure_months} months` : "—"],
        ["Expected IRR",       cc.expected_irr != null ? `${Number(cc.expected_irr)}% p.a.` : "—"],
        ["End Use",            trunc(cc.end_use ?? "—", 80)],
        ["Collateral",         trunc(cc.collateral_summary ?? "—", 80)],
        ["Legal Constitution", trunc(cc.legal_constitution ?? "—", 60)],
      ];
      const hdr = [
        { text: "Parameter", options: { bold: true, fontSize: 10, color: C.body, fill: { color: C.gold }, fontFace: "Calibri" } },
        { text: "Details",   options: { bold: true, fontSize: 10, color: C.body, fill: { color: C.gold }, fontFace: "Calibri" } },
      ];
      const tRows = dealPairs.map(([l, v], ri) => {
        const bg = ri % 2 === 0 ? C.white : C.altRow;
        return [
          { text: l, options: { bold: true, fontSize: 10, color: C.navy, fill: { color: bg }, fontFace: "Calibri" } },
          { text: v, options: { fontSize: 10, color: C.body, fill: { color: bg }, fontFace: "Calibri", wrap: true } },
        ];
      });
      s.addTable([hdr, ...tRows] as never, {
        x: MX, y: HDR_H + 0.18, w: W - MX * 2, rowH: 0.32,
        border: { pt: 0.5, color: C.border }, colW: [2.5, 10.2],
      } as never);
    } else {
      addNarrative(s, tpls[sec.id]);
    }
    pg++;
  }

  // ── Section V — Historical Financials (7 slides) ──────────────────────────
  {
    const hYears = histFyYears(extracted);
    const unit   = rawUnit(extracted);
    const uLabel = unitLabel(unit);
    const shownY = hYears.slice(-5);

    const plGroups: { title: string; labels: string[] }[] = [
      { title: `Historical Financials – P&L (1/2) (₹ ${uLabel})`,
        labels: ["Turnover","Cost of Goods Sold","Gross Profit","Operating Expenses","EBITDA"] },
      { title: `Historical Financials – P&L (2/2) (₹ ${uLabel})`,
        labels: ["EBIT","Interest Expense","Profit Before Tax","Tax","PAT"] },
      { title: `Historical Financials – Balance Sheet (1/3) (₹ ${uLabel})`,
        labels: ["Fixed Assets (Net)","Inventory","Trade Receivables","Cash & Bank","Current Assets"] },
      { title: `Historical Financials – Balance Sheet (2/3) (₹ ${uLabel})`,
        labels: ["Trade Payables","Short Term Borrowings","Long Term Borrowings","Current Liabilities","Total Debt"] },
      { title: `Historical Financials – Balance Sheet (3/3) (₹ ${uLabel})`,
        labels: ["Net Worth","Capital Employed","Working Capital","Total Assets"] },
    ];

    for (const grp of plGroups) {
      const s = deckSlide(pptx, "V", grp.title, logo, pg);
      if (shownY.length === 0) {
        s.addText("No historical financial data available.", {
          x: MX + 0.2, y: HDR_H + 0.4, w: W - MX * 2 - 0.4, h: 0.4,
          fontSize: 11, color: C.muted, fontFace: "Calibri", italic: true,
        } as never);
      } else {
        const hdrs = [`Item`, ...shownY.map(y => `FY ${y}`), "YoY %"];
        const cW   = [3.2, ...shownY.map(() => (W - MX * 2 - 3.2 - 1.1) / shownY.length), 1.1];
        const rows = finRows(extracted, grp.labels, shownY, unit);
        addGoldTable(s, HDR_H + 0.18, hdrs, rows, cW);
      }
      pg++;
    }

    // V-f: Projected Financials
    {
      const projYears = [...new Set(
        extracted.filter(r => r.statement_type === "projections" && r.fiscal_year != null).map(r => r.fiscal_year as number),
      )].sort((a, b) => a - b);

      const s = deckSlide(pptx, "V", "Projected Financials (₹ Lakhs)", logo, pg);
      if (!projYears.length) {
        s.addText("No projection data available.", {
          x: MX + 0.2, y: HDR_H + 0.4, w: W - MX * 2 - 0.4, h: 0.4,
          fontSize: 11, color: C.muted, fontFace: "Calibri", italic: true,
        } as never);
      } else {
        const projLabels = ["Projected Turnover","Projected EBITDA","Projected PAT","Projected Net Worth","Projected Total Debt"];
        const hdrs = ["Metric (₹ Lakhs)", ...projYears.map(y => `FY ${y} (P)`)];
        const cW   = [3.5, ...projYears.map(() => (W - MX * 2 - 3.5) / projYears.length)];
        const rows = projLabels.map(l => [l, ...projYears.map(y => fmtNum(projVal(extracted, y, l)))]);
        addGoldTable(s, HDR_H + 0.18, hdrs, rows, cW);
      }
      pg++;
    }

    // V-g: Commentary
    {
      const s = deckSlide(pptx, "V", "Historical Financial Analysis – Commentary", logo, pg);
      addNarrative(s, tpls["historical_financial"]);
      pg++;
    }
  }

  // ── Section VI — Projections (narrative) ──────────────────────────────────
  {
    const s = deckSlide(pptx, "VI", "Projections & Estimates", logo, pg);
    addNarrative(s, tpls["projections"]);
    pg++;
  }

  // ── Section VII — Key Ratios (9 + commentary) ────────────────────────────
  {
    const CAT_ORDER  = ["coverage","liquidity","solvency","profitability","efficiency","expenses","r_score","return"];
    const CAT_TITLES: Record<string, string> = {
      coverage: "Coverage Ratios", liquidity: "Liquidity Ratios",
      solvency: "Solvency Ratios", profitability: "Profitability Ratios",
      efficiency: "Efficiency & Turnover", expenses: "Expense Ratios",
      r_score: "R' Score Components", return: "Return Ratios",
    };

    const byCat: Record<string, RatioRow[]> = {};
    for (const r of ratios) { const c = (r as never as Record<string, unknown>)["category"] as string ?? "other"; (byCat[c] ??= []).push(r); }
    const cats = [...CAT_ORDER.filter(c => byCat[c]), ...Object.keys(byCat).filter(c => !CAT_ORDER.includes(c))];

    for (const cat of cats) {
      const catR = byCat[cat];
      const allYears = [...new Set(catR.map(r => Number((r as never as Record<string, unknown>)["fiscal_year"])).filter(Boolean))].sort((a, b) => a - b);
      if (!allYears.length) continue;
      const years = allYears.slice(-5);

      const s = deckSlide(pptx, "VII", CAT_TITLES[cat] ?? cap(cat), logo, pg);

      const byName: Record<string, { vals: Record<string, string>; bench: string }> = {};
      for (const r of catR as never as Record<string, unknown>[]) {
        const dn = RATIO_NAMES[String(r["ratio_name"] ?? "")] ?? cap(String(r["ratio_name"] ?? ""));
        if (!byName[dn]) byName[dn] = { vals: {}, bench: "—" };
        const val    = r["ratio_value"] != null ? Number(r["ratio_value"]).toFixed(2) : "—";
        const suffix = r["threshold_status"] === "green" ? " ✓" : r["threshold_status"] === "red" ? " ✗" : r["threshold_status"] === "amber" ? " !" : "";
        byName[dn].vals[String(r["fiscal_year"])] = val + suffix;
        if (r["benchmark"] != null) byName[dn].bench = String(r["benchmark"]);
      }

      const names = Object.keys(byName);
      const hdrs  = ["Ratio", ...years.map(y => `FY ${y}`), "Bench"];
      const cW    = [3.0, ...years.map(() => (W - MX * 2 - 3.0 - 1.1) / years.length), 1.1];
      const rows  = names.map(n => [trunc(n, 40), ...years.map(y => byName[n].vals[String(y)] ?? "—"), byName[n].bench]);
      addGoldTable(s, HDR_H + 0.18, hdrs, rows, cW);
      pg++;
    }

    // VII commentary
    {
      const s = deckSlide(pptx, "VII", "Key Financial Ratios – Commentary", logo, pg);
      addNarrative(s, tpls["key_ratios"]);
      pg++;
    }
  }

  // ── Sections VIII–IX ──────────────────────────────────────────────────────
  for (const sec of [
    { id: "cash_flow",     roman: "VIII", title: "Cash Flow Statement" },
    { id: "due_diligence", roman: "IX",   title: "Due Diligence Excerpts" },
  ]) {
    const s = deckSlide(pptx, sec.roman, sec.title, logo, pg);
    addNarrative(s, tpls[sec.id]);
    pg++;
  }

  // ── Section X — Risk Assessment ───────────────────────────────────────────
  {
    const s = deckSlide(pptx, "X", "Risk Assessment & Mitigation", logo, pg);
    const risks = ic.risks ?? [];
    if (!risks.length) {
      s.addText("No risks entered. Add them in the IC Note tab.", {
        x: MX + 0.2, y: HDR_H + 0.4, w: W - MX * 2 - 0.4, h: 0.4,
        fontSize: 11, color: C.muted, fontFace: "Calibri", italic: true,
      } as never);
    } else {
      const hdrs = ["Category", "Risk", "Mitigant", "Sev."];
      const rows = risks.map(r => [trunc(r.category, 25), trunc(r.risk, 80), trunc(r.mitigant, 90), (r.severity ?? "—").slice(0, 3)]);
      addGoldTable(s, HDR_H + 0.18, hdrs, rows, [2.0, 3.8, 5.0, 1.7], 0.32);
    }
    pg++;
  }

  // ── Sections XI–XIV (narrative) ───────────────────────────────────────────
  for (const sec of [
    { id: "visit_reference",        roman: "XI",   title: "Visit Report" },
    { id: "exec_recommendation",    roman: "XII",  title: "Executive Team Recommendation" },
    { id: "product_specifics",      roman: "XIII", title: "Specific Product Requirements" },
    { id: "triangulation_analysis", roman: "XIV",  title: "Triangulation Analysis" },
  ]) {
    const s = deckSlide(pptx, sec.roman, sec.title, logo, pg);
    addNarrative(s, tpls[sec.id]);
    pg++;
  }

  // ── Section XV — Conditions Precedent ────────────────────────────────────
  {
    const s = deckSlide(pptx, "XV", "Conditions Precedent", logo, pg);
    const cps = ic.conditions_precedent ?? [];
    if (!cps.length) {
      s.addText("No conditions entered. Add them in the IC Note tab.", {
        x: MX + 0.2, y: HDR_H + 0.4, w: W - MX * 2 - 0.4, h: 0.4,
        fontSize: 11, color: C.muted, fontFace: "Calibri", italic: true,
      } as never);
    } else {
      let y = HDR_H + 0.22;
      for (let i = 0; i < cps.length && y < H - FTR_H - 0.25; i++) {
        s.addText([
          { text: `${String(i + 1).padStart(2, "0")}.  `, options: { bold: true, color: C.navy_s, fontSize: 11, fontFace: "Georgia" } },
          { text: trunc(cps[i], 250), options: { color: C.body, fontSize: 11, fontFace: "Calibri" } },
        ], { x: MX + 0.2, y, w: W - MX * 2 - 0.4, h: 0.36, valign: "top" } as never);
        y += 0.39;
      }
    }
    pg++;
  }

  // ── Section XVI — SWOT ────────────────────────────────────────────────────
  {
    const s = deckSlide(pptx, "XVI", "SWOT Analysis", logo, pg);
    if (!ic.swot) {
      s.addText("SWOT not entered. Add it in the IC Note tab.", {
        x: MX + 0.2, y: HDR_H + 0.4, w: W - MX * 2 - 0.4, h: 0.4,
        fontSize: 11, color: C.muted, fontFace: "Calibri", italic: true,
      } as never);
    } else {
      const swot = ic.swot;
      const gap  = 0.18;
      const qW   = (W - MX * 2 - gap) / 2;
      const qH   = (H - HDR_H - FTR_H - gap - 0.2) / 2;

      const quads = [
        { label: "STRENGTHS",     items: swot.strengths ?? [],     x: MX,            y: HDR_H + 0.12, color: "166534", bg: "F0FDF4", border: "86EFAC" },
        { label: "WEAKNESSES",    items: swot.weaknesses ?? [],    x: MX + qW + gap, y: HDR_H + 0.12, color: "991B1B", bg: "FEF2F2", border: "FCA5A5" },
        { label: "OPPORTUNITIES", items: swot.opportunities ?? [], x: MX,            y: HDR_H + 0.12 + qH + gap, color: "1E40AF", bg: "EFF6FF", border: "93C5FD" },
        { label: "THREATS",       items: swot.threats ?? [],       x: MX + qW + gap, y: HDR_H + 0.12 + qH + gap, color: "92400E", bg: "FFFBEB", border: "FCD34D" },
      ] as const;

      for (const q of quads) {
        s.addShape("rect" as never, { x: q.x, y: q.y, w: qW, h: qH, fill: { color: q.bg }, line: { color: q.border, pt: 1.2 } } as never);
        s.addText(q.label, { x: q.x + 0.14, y: q.y + 0.08, w: qW - 0.28, h: 0.26, fontSize: 9, bold: true, color: q.color, fontFace: "Georgia", charSpacing: 2 } as never);
        const bullets = (q.items as string[]).slice(0, 6).map(it => `• ${trunc(it, 90)}`).join("\n");
        s.addText(bullets || "—", { x: q.x + 0.14, y: q.y + 0.38, w: qW - 0.28, h: qH - 0.46, fontSize: 9.5, color: C.body, fontFace: "Calibri", valign: "top", paraSpaceAfter: 3 } as never);
      }
    }
    pg++;
  }

  // ── Annexures divider ─────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: C.navy };
    s.addShape("rect" as never, { x: 0, y: 0, w: W, h: 0.06, fill: { color: C.gold }, line: { color: C.gold } } as never);
    if (logo) s.addImage({ data: logo, x: 0.35, y: 0.22, w: 1.7, h: 0.44 } as never);
    s.addShape("ellipse" as never, { x: (W - 4.5) / 2, y: (H - 4.5) / 2, w: 4.5, h: 4.5, fill: { color: C.white, transparency: 93 }, line: { color: C.white, pt: 0, transparency: 93 } } as never);
    s.addText("A", { x: (W - 4.5) / 2, y: (H - 4.5) / 2 + 0.35, w: 4.5, h: 3.5, fontSize: 120, color: C.white, fontFace: "Georgia", align: "center", transparency: 90 } as never);
    s.addText("Annexures", { x: MX, y: H / 2 - 0.65, w: W - MX * 2, h: 1.0, fontSize: 34, bold: true, color: C.gold, fontFace: "Georgia", align: "center" } as never);
    s.addText(clientName, { x: MX, y: H / 2 + 0.5, w: W - MX * 2, h: 0.42, fontSize: 14, color: C.white, fontFace: "Calibri", align: "center" } as never);
    s.addShape("rect" as never, { x: 0, y: H - 0.28, w: W, h: 0.28, fill: { color: C.gold }, line: { color: C.gold } } as never);
    s.addText("Confidential – Rehbar Financial Services", { x: MX, y: H - 0.27, w: W - MX * 2, h: 0.27, fontSize: 8.5, color: C.navy, bold: true, fontFace: "Calibri", align: "center", valign: "middle" } as never);
    pg++;
  }

  // ── Site Visit Pictures ───────────────────────────────────────────────────
  {
    const s = deckSlide(pptx, null, `Site Visit Pictures — ${trunc(clientName, 40)}`, logo, pg);
    const bW = (W - MX * 2 - 0.25) / 2;
    const bH = H - HDR_H - FTR_H - 0.35;
    s.addShape("rect" as never, { x: MX, y: HDR_H + 0.18, w: bW, h: bH, fill: { color: "F5F5F0" }, line: { color: "D4D4CE", pt: 1.5, dashType: "dash" } } as never);
    s.addShape("rect" as never, { x: MX + bW + 0.25, y: HDR_H + 0.18, w: bW, h: bH, fill: { color: "F5F5F0" }, line: { color: "D4D4CE", pt: 1.5, dashType: "dash" } } as never);
    pg++;
  }

  // ── Data Visualization ────────────────────────────────────────────────────
  {
    const s = deckSlide(pptx, null, "Data Visualization — Sourced from Accumn", logo, pg);
    const bW = W - MX * 2;
    const bH = H - HDR_H - FTR_H - 0.35;
    s.addShape("rect" as never, { x: MX, y: HDR_H + 0.18, w: bW, h: bH, fill: { color: "F5F5F0" }, line: { color: "D4D4CE", pt: 1.5, dashType: "dash" } } as never);
    pg++;
  }

  // ── IC Approval Conditions ────────────────────────────────────────────────
  {
    const s = deckSlide(pptx, null, "IC Approval Conditions", logo, pg);
    const conditions = (ic as Record<string, unknown>)["ic_approval_conditions"] as string | undefined;
    if (conditions?.trim()) {
      s.addText(conditions, {
        x: MX + 0.2, y: HDR_H + 0.22, w: W - MX * 2 - 0.4, h: H - HDR_H - FTR_H - 0.3,
        fontSize: 11, color: C.body, fontFace: "Calibri", valign: "top", wrap: true,
      } as never);
    }
    pg++;
  }

  // ── Investment Policies ───────────────────────────────────────────────────
  {
    deckSlide(pptx, null, "Rehbar Investment Approval Policies", logo, pg);
    pg++;
  }

  // ── Closing ───────────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: C.navy };
    s.addShape("rect" as never, { x: 0, y: 0, w: W, h: 0.08, fill: { color: C.gold }, line: { color: C.gold } } as never);
    if (logo) s.addImage({ data: logo, x: (W - 3.4) / 2, y: 1.4, w: 3.4, h: 0.88 } as never);
    s.addText("This presentation is strictly confidential\nand prepared for internal Investment Committee use only.", {
      x: 1.5, y: 2.9, w: W - 3.0, h: 1.0,
      fontSize: 12, color: C.white, align: "center", fontFace: "Calibri",
    } as never);
    s.addText(clientName, {
      x: 0, y: 4.1, w: W, h: 0.4,
      fontSize: 12, color: C.gold, align: "center", fontFace: "Georgia",
    } as never);
    s.addShape("rect" as never, { x: 0, y: H - 0.28, w: W, h: 0.28, fill: { color: C.gold }, line: { color: C.gold } } as never);
    s.addText("© Rehbar Financial Services  ·  rehbar.co.in", {
      x: 0, y: H - 0.27, w: W, h: 0.27,
      fontSize: 8.5, color: C.navy, bold: true, align: "center", fontFace: "Calibri", valign: "middle",
    } as never);
  }

  const safeName = clientName.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 40);
  await pptx.writeFile({ fileName: `IC_Deck_${safeName}_${new Date().toISOString().slice(0, 10)}.pptx` });
}
