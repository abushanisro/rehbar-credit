import PptxGenJS from "pptxgenjs";
import { IC_SECTIONS, RATIO_DISPLAY_NAMES } from "@/features/credit/domain";
import type { IcNoteShape } from "@/tabs/case/ic/ICNoteDocument";
import type { CaseRow, ExtractedRow, RatioRow } from "@/features/case/types";

type Slide = ReturnType<PptxGenJS["addSlide"]>;

// Each extracted_financials row stores data as line_items JSON array
interface LineItem {
  label: string;
  value: number | null;
  override_value?: number | null;
  is_section?: boolean;
  indent?: number;
}

// ── Brand colors ──────────────────────────────────────────────────────────────
const C = {
  navy:    "0F1B2D",
  cream:   "FAFAF6",
  gold:    "8B6914",
  goldLt:  "C4A04A",
  ink:     "1C1C1E",
  border:  "E5E7EB",
  muted:   "9CA3AF",
  bgLight: "F3F4F6",
  red:     "DC2626",
  amber:   "D97706",
  blue:    "1D4ED8",
  green:   "16A34A",
};

const W = 13.33;
const H = 7.5;
const HEADER_H = 1.08;
const LOGO_W = 1.85;
const LOGO_H = 0.58;
const MAX_BLOCKS = 16;
const MAX_YEARS = 5; // cap columns to prevent overflow

// ── Number formatter — compact Indian format for PPT cells ────────────────────
function fmtNum(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs === 0) return "0";
  if (abs >= 1_00_00_000) return `${(v / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000)    return `${(v / 1_00_000).toFixed(2)} L`;
  if (abs >= 1_000)       return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return v.toFixed(2);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ── Fetch Rehbar logo as base64 ───────────────────────────────────────────────
async function fetchLogoData(): Promise<string | null> {
  try {
    const res = await fetch("/Rehbar_logo.png");
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ── Markdown helpers ──────────────────────────────────────────────────────────
function stripMd(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\|.*\|$/gm, "")
    .replace(/^[-:| ]+$/gm, "")
    .trim();
}

type Block = { type: "heading" | "bullet" | "text"; text: string };
type SectionTemplate = { headline?: string; bullets?: string[]; flags?: string[] };

function templateToBlocks(t: SectionTemplate): Block[] {
  const blocks: Block[] = [];
  if (t.headline) blocks.push({ type: "heading", text: t.headline });
  for (const b of t.bullets ?? []) blocks.push({ type: "bullet", text: b });
  for (const f of t.flags ?? []) blocks.push({ type: "bullet", text: `⚠ ${f}` });
  return blocks;
}

function parseBlocks(md: string): Block[] {
  return md.split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => !l.startsWith("|") && !/^[-:]+\|/.test(l))
    .map(line => {
      const clean = line
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/_(.*?)_/g, "$1")
        .replace(/`(.*?)`/g, "$1");
      if (/^#{1,3}\s/.test(line)) return { type: "heading" as const, text: clean.replace(/^#{1,3}\s+/, "") };
      if (/^[-*▸▲↑↓•]\s/.test(line)) return { type: "bullet" as const, text: clean.replace(/^[-*▸▲↑↓•]\s+/, "") };
      if (/^\d+\.\s/.test(line))   return { type: "bullet" as const, text: clean.replace(/^\d+\.\s+/, "") };
      return { type: "text" as const, text: clean };
    });
}

// ── Column width calculator ───────────────────────────────────────────────────
function calcColW(numYears: number, hasBench = false): number[] {
  const total = W - 0.9;
  const benchW = hasBench ? 1.3 : 0;
  const labelsW = Math.max(3.5, 5.2 - numYears * 0.3);
  const yearW = (total - labelsW - benchW) / numYears;
  return hasBench
    ? [labelsW, ...Array(numYears).fill(yearW), benchW]
    : [labelsW, ...Array(numYears).fill(yearW)];
}

// ── Slide building helpers ────────────────────────────────────────────────────

// Original navy header — kept for data/table slides (financial tables, ratios, etc.)
function addHeader(slide: Slide, title: string, sub?: string, logoData?: string | null) {
  slide.addShape("rect" as never, {
    x: 0, y: 0, w: W, h: HEADER_H,
    fill: { color: C.navy }, line: { color: C.navy },
  } as never);
  slide.addShape("rect" as never, {
    x: 0, y: HEADER_H, w: W, h: 0.04,
    fill: { color: C.goldLt }, line: { color: C.goldLt },
  } as never);
  const textW = logoData ? W - LOGO_W - 1.0 : W - 0.9;
  if (sub) {
    slide.addText(sub, {
      x: 0.45, y: 0.1, w: textW, h: 0.27,
      fontSize: 7, color: C.goldLt, fontFace: "Georgia", charSpacing: 2,
    } as never);
  }
  slide.addText(title, {
    x: 0.45, y: sub ? 0.33 : 0.23, w: textW, h: 0.65,
    fontSize: sub ? 18 : 22, color: C.cream, bold: true, fontFace: "Georgia",
  } as never);
  if (logoData) {
    slide.addImage({
      data: logoData,
      x: W - LOGO_W - 0.2,
      y: (HEADER_H - LOGO_H) / 2,
      w: LOGO_W, h: LOGO_H,
    } as never);
  }
}

const STRIPE_W  = 0.28;   // left navy accent stripe width (shared with TOC)
const DARK_GREEN = "2B5738"; // header row colour matching TOC

// ── Content slides — exact same table format as the TOC slide ─────────────────
function addContentSlides(
  pptx: PptxGenJS,
  logoData: string | null,
  title: string,
  sub: string,
  blocks: Block[],
  _cc?: CaseRow | null, // reserved, not needed in table format
) {
  if (!blocks.length) return;

  // Paginate: max rows per slide so the table never overflows
  const MAX_ROWS = 13;
  const chunks: Block[][] = [];
  let cur: Block[] = [];
  for (const b of blocks) {
    if (cur.length >= MAX_ROWS) { chunks.push(cur); cur = []; }
    cur.push(b);
  }
  if (cur.length) chunks.push(cur);

  chunks.forEach((chunk, ci) => {
    const s = pptx.addSlide();
    s.background = { color: "F4F4F2" };

    // Left navy accent stripe (full height — same as TOC)
    s.addShape("rect" as never, { x: 0, y: 0, w: STRIPE_W, h: H, fill: { color: C.navy }, line: { color: C.navy } } as never);

    // Rehbar logo — top right (same size/position as TOC)
    if (logoData) {
      s.addImage({ data: logoData, x: W - 1.72, y: 0.07, w: 1.55, h: 0.48 } as never);
    }

    const pageLabel = chunks.length > 1 ? `${sub}  (${ci + 1} / ${chunks.length})` : sub;

    // ── Header row (dark green, identical to TOC) ────────────────────────────
    const headerRow = [
      {
        text: `• ${title}`,
        options: { bold: true, color: "FFFFFF", fill: { color: DARK_GREEN }, fontSize: 10.5, fontFace: "Georgia", align: "left" as const },
      },
      {
        text: "Particulars",
        options: { bold: true, color: "FFFFFF", fill: { color: DARK_GREEN }, fontSize: 9, fontFace: "Calibri", align: "center" as const },
      },
      {
        text: pageLabel,
        options: { bold: false, color: "FFFFFF", fill: { color: DARK_GREEN }, fontSize: 7, fontFace: "Calibri", align: "center" as const, transparency: 25 },
      },
    ];

    // ── Data rows ────────────────────────────────────────────────────────────
    let bulletIdx = 0;
    const dataRows = chunk.map((block, bi) => {
      const bg = bi % 2 === 0 ? "FFFFFF" : "F0F0EE";

      if (block.type === "heading") {
        // Sub-heading row: spans visually — green-tinted bg, bold navy text
        return [
          {
            text: "▸",
            options: { fontSize: 9, bold: true, color: "FFFFFF", fill: { color: DARK_GREEN }, fontFace: "Calibri", align: "center" as const },
          },
          {
            text: block.text,
            options: { fontSize: 10, bold: true, color: C.navy, fill: { color: "E8F0EA" }, fontFace: "Georgia", align: "left" as const, wrap: true },
          },
          {
            text: "",
            options: { fill: { color: "E8F0EA" } },
          },
        ];
      }

      bulletIdx++;
      return [
        {
          // "Section N" style — dark navy bg, white bold text, centred (same as TOC left col)
          text: String(bulletIdx).padStart(2, "0"),
          options: { fontSize: 9, bold: true, color: "FFFFFF", fill: { color: C.navy }, fontFace: "Calibri", align: "center" as const },
        },
        {
          text: truncate(block.text, 220),
          options: { fontSize: 9.5, color: C.ink, fill: { color: bg }, fontFace: "Calibri", align: "left" as const, wrap: true },
        },
        {
          text: "",
          options: { fill: { color: bg } },
        },
      ];
    });

    // Dynamic row height: fills the available slide area
    const tableH   = H - 0.28 - 0.22; // top margin + footer
    const rowH     = Math.min(0.48, tableH / (chunk.length + 1));

    s.addTable([headerRow, ...dataRows] as never, {
      x: STRIPE_W, y: 0.08, w: W - STRIPE_W,
      rowH,
      border: { pt: 0.5, color: "DEDEDE" },
      fontFace: "Calibri",
      colW: [1.75, 10.0, 1.3],
    } as never);

    // Confidential footer (identical to TOC)
    s.addText("CONFIDENTIAL  ·  REHBAR FINANCIAL SERVICES", {
      x: STRIPE_W, y: H - 0.2, w: W - STRIPE_W, h: 0.2,
      fontSize: 6.5, color: C.muted, align: "center" as const, fontFace: "Calibri", charSpacing: 1.5,
    } as never);
  });
}

// Generic data table slide (rows = [label, val1, val2, ...], all strings)
function addTableSlide(
  pptx: PptxGenJS,
  logoData: string | null,
  title: string,
  sub: string,
  headers: string[],
  rows: string[][],
  colW: number[],
) {
  if (!rows.length) return;
  const MAX_ROWS = 22;
  const totalChunks = Math.ceil(rows.length / MAX_ROWS);

  for (let ci = 0; ci < totalChunks; ci++) {
    const chunk = rows.slice(ci * MAX_ROWS, (ci + 1) * MAX_ROWS);
    const s = pptx.addSlide();
    s.background = { color: C.cream };
    const label = totalChunks > 1 ? `${sub}  (${ci + 1} / ${totalChunks})` : sub;
    addHeader(s, title, label, logoData);

    const headerRow = headers.map((h, idx) => ({
      text: h,
      options: {
        bold: true, color: C.cream, fill: { color: C.navy },
        fontSize: 8.5, fontFace: "Calibri",
        align: (idx === 0 ? "left" : "center") as "left" | "center",
        wrap: true,
      },
    }));

    const dataRows = chunk.map((row, ri) =>
      row.map((cell, idx) => ({
        text: cell,
        options: {
          fontSize: 8.5, color: C.ink, fontFace: "Calibri",
          fill: { color: ri % 2 === 0 ? C.cream : C.bgLight },
          align: (idx === 0 ? "left" : "center") as "left" | "center",
          wrap: true,
        },
      })),
    );

    s.addTable([headerRow, ...dataRows] as never, {
      x: 0.45, y: HEADER_H + 0.18, w: W - 0.9,
      rowH: 0.28,
      border: { pt: 0.5, color: C.border },
      fontFace: "Calibri",
      colW,
    } as never);
  }
}

// ── Extract line_items from all rows for a statement type ─────────────────────
function extractFinancialTable(rows: ExtractedRow[]): {
  labels: string[];
  years: number[];
  byLabel: Record<string, Record<string, number | null>>;
} {
  const years = [...new Set(rows.map(r => r.fiscal_year).filter((y): y is number => y != null))].sort();
  const byLabel: Record<string, Record<string, number | null>> = {};
  const labelOrder: string[] = [];

  for (const row of rows) {
    const items = (row.line_items as unknown as LineItem[]) ?? [];
    for (const item of items) {
      if (item.is_section) continue;
      if (!byLabel[item.label]) { byLabel[item.label] = {}; labelOrder.push(item.label); }
      byLabel[item.label][String(row.fiscal_year)] = item.override_value ?? item.value;
    }
  }

  return { labels: labelOrder, years, byLabel };
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateIcPpt(params: {
  cc: CaseRow;
  ic: IcNoteShape;
  extracted: ExtractedRow[];
  ratios: RatioRow[];
  company?: Record<string, string | null> | null;
  directors?: Record<string, string | null>[] | null;
}): Promise<void> {
  const { cc, ic, extracted, ratios, company, directors } = params;
  const borrowerName = cc.client_name ?? "Borrower";
  const dealAmount = cc.deal_amount ? `₹${cc.deal_amount} Cr` : "—";
  const logoData = await fetchLogoData();

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Rehbar Credit Terminal";
  pptx.company = "Rehbar Financial Services";
  pptx.subject = `IC Appraisal Note — ${borrowerName}`;
  pptx.title = "Investment Committee Credit Appraisal Note";

  // ── Slide 1: Cover (Investment Proposal style) ───────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };

    // Left panel — molecular network graphic (SVG embedded as base64)
    const net = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="540" viewBox="0 0 400 540">',
      // connection lines
      '<line x1="190" y1="270" x2="110" y2="170" stroke="#1a3a5c" stroke-width="1.4" opacity="0.32"/>',
      '<line x1="190" y1="270" x2="280" y2="200" stroke="#1a3a5c" stroke-width="1.4" opacity="0.32"/>',
      '<line x1="190" y1="270" x2="150" y2="385" stroke="#1a3a5c" stroke-width="1.4" opacity="0.32"/>',
      '<line x1="190" y1="270" x2="268" y2="372" stroke="#1a3a5c" stroke-width="1.4" opacity="0.32"/>',
      '<line x1="190" y1="270" x2="78" y2="302" stroke="#1a3a5c" stroke-width="1.4" opacity="0.32"/>',
      '<line x1="190" y1="270" x2="222" y2="158" stroke="#1a3a5c" stroke-width="1.4" opacity="0.32"/>',
      '<line x1="110" y1="170" x2="48" y2="118" stroke="#1a3a5c" stroke-width="1" opacity="0.26"/>',
      '<line x1="110" y1="170" x2="63" y2="222" stroke="#1a3a5c" stroke-width="1" opacity="0.26"/>',
      '<line x1="280" y1="200" x2="342" y2="148" stroke="#1a3a5c" stroke-width="1" opacity="0.26"/>',
      '<line x1="280" y1="200" x2="334" y2="272" stroke="#1a3a5c" stroke-width="1" opacity="0.26"/>',
      '<line x1="150" y1="385" x2="88" y2="452" stroke="#1a3a5c" stroke-width="1" opacity="0.26"/>',
      '<line x1="150" y1="385" x2="78" y2="302" stroke="#1a3a5c" stroke-width="1" opacity="0.26"/>',
      '<line x1="268" y1="372" x2="312" y2="444" stroke="#1a3a5c" stroke-width="1" opacity="0.26"/>',
      '<line x1="222" y1="158" x2="282" y2="98" stroke="#1a3a5c" stroke-width="1" opacity="0.26"/>',
      '<line x1="222" y1="158" x2="158" y2="98" stroke="#1a3a5c" stroke-width="1" opacity="0.26"/>',
      '<line x1="48" y1="118" x2="98" y2="58" stroke="#1a3a5c" stroke-width="0.8" opacity="0.2"/>',
      '<line x1="334" y1="272" x2="372" y2="344" stroke="#1a3a5c" stroke-width="0.8" opacity="0.2"/>',
      '<line x1="88" y1="452" x2="128" y2="514" stroke="#1a3a5c" stroke-width="0.8" opacity="0.2"/>',
      '<line x1="312" y1="444" x2="358" y2="494" stroke="#1a3a5c" stroke-width="0.8" opacity="0.2"/>',
      '<line x1="78" y1="302" x2="48" y2="118" stroke="#7B1A1A" stroke-width="1" opacity="0.22"/>',
      // main center node
      '<circle cx="190" cy="270" r="22" fill="#0F1B2D"/>',
      '<circle cx="183" cy="263" r="7" fill="#2a4a6c" opacity="0.45"/>',
      // secondary nodes
      '<circle cx="110" cy="170" r="17" fill="#0F1B2D"/>',
      '<circle cx="104" cy="164" r="5" fill="#2a4a6c" opacity="0.45"/>',
      '<circle cx="280" cy="200" r="18" fill="#0F1B2D"/>',
      '<circle cx="273" cy="193" r="6" fill="#2a4a6c" opacity="0.45"/>',
      '<circle cx="150" cy="385" r="15" fill="#0F1B2D"/>',
      '<circle cx="144" cy="379" r="5" fill="#2a4a6c" opacity="0.45"/>',
      '<circle cx="268" cy="372" r="16" fill="#0F1B2D"/>',
      '<circle cx="262" cy="366" r="5" fill="#2a4a6c" opacity="0.45"/>',
      // red accent nodes
      '<circle cx="78" cy="302" r="14" fill="#8B1A1A"/>',
      '<circle cx="73" cy="297" r="4" fill="#c04040" opacity="0.45"/>',
      '<circle cx="222" cy="158" r="13" fill="#8B1A1A"/>',
      '<circle cx="217" cy="153" r="4" fill="#c04040" opacity="0.45"/>',
      // tertiary nodes
      '<circle cx="48" cy="118" r="11" fill="#0F1B2D" opacity="0.88"/>',
      '<circle cx="342" cy="148" r="12" fill="#0F1B2D" opacity="0.88"/>',
      '<circle cx="334" cy="272" r="10" fill="#0F1B2D" opacity="0.88"/>',
      '<circle cx="63" cy="222" r="10" fill="#0F1B2D" opacity="0.88"/>',
      '<circle cx="88" cy="452" r="11" fill="#0F1B2D" opacity="0.88"/>',
      '<circle cx="312" cy="444" r="12" fill="#0F1B2D" opacity="0.88"/>',
      // small peripheral nodes
      '<circle cx="98" cy="58" r="8" fill="#0F1B2D" opacity="0.78"/>',
      '<circle cx="158" cy="98" r="8" fill="#0F1B2D" opacity="0.78"/>',
      '<circle cx="282" cy="98" r="9" fill="#0F1B2D" opacity="0.78"/>',
      '<circle cx="372" cy="344" r="8" fill="#0F1B2D" opacity="0.78"/>',
      '<circle cx="128" cy="514" r="7" fill="#0F1B2D" opacity="0.78"/>',
      '<circle cx="358" cy="494" r="8" fill="#0F1B2D" opacity="0.78"/>',
      '</svg>',
    ].join("");
    s.addImage({ data: `data:image/svg+xml;base64,${btoa(net)}`, x: 0, y: 0, w: 4.5, h: 7.5 } as never);

    // Last Modified — top-right, italic + underlined
    const modDate = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
    s.addText(`Last Modified : ${modDate}`, {
      x: 6.8, y: 0.12, w: 6.3, h: 0.3,
      fontSize: 9.5, color: "333333", fontFace: "Calibri", italic: true, underline: { pt: 0.5 }, align: "right",
    } as never);

    // Logo — centred in right panel
    const rX = 4.6;
    const rW = W - rX;
    const logoW = 3.6;
    const logoH = 1.12;
    const logoX = rX + (rW - logoW) / 2;
    const logoY = 1.75;
    if (logoData) {
      s.addImage({ data: logoData, x: logoX, y: logoY, w: logoW, h: logoH } as never);
    } else {
      s.addText("REHBAR FINANCIAL SERVICES", { x: rX, y: logoY + 0.25, w: rW, h: 0.55, fontSize: 14, color: C.navy, bold: true, align: "center", fontFace: "Georgia" } as never);
    }

    // Tagline banner
    const bannerW = 4.2;
    const bannerX = rX + (rW - bannerW) / 2;
    const bannerY = logoY + logoH + 0.16;
    s.addShape("rect" as never, { x: bannerX, y: bannerY, w: bannerW, h: 0.28, fill: { color: C.navy }, line: { color: C.navy } } as never);
    s.addText("Your Guide to Secure Profitable Investments", { x: bannerX, y: bannerY + 0.01, w: bannerW, h: 0.28, fontSize: 8, color: C.cream, align: "center", fontFace: "Calibri" } as never);

    // "Investment Proposal" heading
    const proposalY = bannerY + 0.5;
    s.addText("Investment Proposal", {
      x: rX, y: proposalY, w: rW, h: 0.58,
      fontSize: 20, color: C.ink, bold: true, align: "center", fontFace: "Georgia",
    } as never);

    // Thin divider
    const divY = proposalY + 0.64;
    s.addShape("rect" as never, { x: rX + 1.6, y: divY, w: rW - 3.2, h: 0.015, fill: { color: "CCCCCC" }, line: { color: "CCCCCC" } } as never);

    // Borrower name
    s.addText(borrowerName, {
      x: rX, y: divY + 0.14, w: rW, h: 0.52,
      fontSize: 17, color: C.ink, bold: true, align: "center", fontFace: "Georgia",
    } as never);

    // Facility / product type
    const facilityType = cc.product_type
      ? cc.product_type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
      : "Credit Facility";
    s.addText(facilityType, {
      x: rX, y: divY + 0.74, w: rW, h: 0.42,
      fontSize: 13, color: C.muted, align: "center", fontFace: "Calibri",
    } as never);
  }

  // ── Slide 2: Table of Contents (structured table design) ─────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: "F4F4F2" };

    // Left navy accent stripe
    s.addShape("rect" as never, { x: 0, y: 0, w: 0.28, h: H, fill: { color: C.navy }, line: { color: C.navy } } as never);

    // Rehbar logo — top right (small)
    if (logoData) {
      s.addImage({ data: logoData, x: W - 1.72, y: 0.07, w: 1.55, h: 0.48 } as never);
    }

    // Build TOC rows: all IC sections + CP + SWOT
    const tocItems = [
      ...IC_SECTIONS.map((sec, i) => ({
        num: i + 1,
        title: sec.title,
        done: !!(ic.sections?.[sec.id]?.markdown?.trim()),
      })),
      { num: IC_SECTIONS.length + 1, title: "Conditions Precedent", done: !!(ic.conditions_precedent?.length) },
      { num: IC_SECTIONS.length + 2, title: "SWOT Analysis", done: !!ic.swot },
    ];

    // Compute approximate slide numbers for sections that have content
    // Fixed preamble: cover(1) + toc(2) + deal(3) + maybe company(4) + maybe directors(5)
    const preamble = 3 + (company && Object.keys(company).length > 0 ? 1 : 0) + (directors && directors.length > 0 ? 1 : 0);
    let slideCounter = preamble;
    const slideNums: (number | null)[] = tocItems.map((item, idx) => {
      if (!item.done && idx >= IC_SECTIONS.length) return null; // CP/SWOT checked separately
      if (idx < IC_SECTIONS.length) {
        // extra data slides before this IC section
        const secId = IC_SECTIONS[idx]?.id;
        const extraBefore = idx === 0 ? 0 :
          IC_SECTIONS.slice(0, idx).reduce((acc, prev) => {
            if (prev.id === "historical_financial") return acc + Math.min(extracted.length > 0 ? 3 : 0, 4);
            if (prev.id === "key_ratios") return acc + Math.min(ratios.length > 0 ? 3 : 0, 5);
            if (prev.id === "risk_assessment") return acc + (ic.risks && ic.risks.length > 0 ? 1 : 0);
            return acc;
          }, 0);
        void secId; void extraBefore; // suppress unused
      }
      slideCounter += 1;
      return item.done ? slideCounter : null;
    });

    const DARK_GREEN = "2B5738";

    const headerRow = [
      {
        text: "• Table of Content",
        options: { bold: true, color: "FFFFFF", fill: { color: DARK_GREEN }, fontSize: 10.5, fontFace: "Georgia", align: "left" as const },
      },
      {
        text: "Particulars",
        options: { bold: true, color: "FFFFFF", fill: { color: DARK_GREEN }, fontSize: 9, fontFace: "Calibri", align: "center" as const },
      },
      {
        text: "Page No.",
        options: { bold: true, color: "FFFFFF", fill: { color: DARK_GREEN }, fontSize: 9, fontFace: "Calibri", align: "center" as const },
      },
    ];

    const dataRows = tocItems.map((item, i) => {
      const bg = i % 2 === 0 ? "FFFFFF" : "F0F0EE";
      const pageVal = slideNums[i] != null ? String(slideNums[i]) : "NA";
      const pageColor = slideNums[i] != null ? C.ink : C.muted;
      return [
        {
          text: `Section ${item.num}`,
          options: {
            fontSize: 8.5, bold: true, color: "FFFFFF",
            fill: { color: C.navy }, fontFace: "Calibri", align: "center" as const,
          },
        },
        {
          text: item.title,
          options: {
            fontSize: 9.5, color: C.ink,
            fill: { color: bg }, fontFace: "Calibri", align: "left" as const,
          },
        },
        {
          text: pageVal,
          options: {
            fontSize: 9, color: pageColor,
            fill: { color: bg }, fontFace: "Calibri", align: "center" as const,
          },
        },
      ];
    });

    const rowH = Math.min(0.48, (H - 0.28 - 0.22) / (tocItems.length + 1));
    s.addTable([headerRow, ...dataRows] as never, {
      x: 0.28, y: 0.08, w: W - 0.28,
      rowH,
      border: { pt: 0.5, color: "DEDEDE" },
      fontFace: "Calibri",
      colW: [1.75, 10.0, 1.3],
    } as never);

    // Confidential footer
    s.addText("CONFIDENTIAL  ·  REHBAR FINANCIAL SERVICES", {
      x: 0.28, y: H - 0.2, w: W - 0.28, h: 0.2,
      fontSize: 6.5, color: C.muted, align: "center", fontFace: "Calibri", charSpacing: 1.5,
    } as never);
  }

  // ── Slide 3: Deal Summary ──────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: C.cream };
    addHeader(s, "Deal Summary", "Proposed Investment Structure", logoData);

    const dealRows = [
      ["Borrower", borrowerName, "Case Reference", cc.case_code ?? "—"],
      ["Product", cc.product_type ? cc.product_type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "—", "Deal Amount", dealAmount],
      ["Tenure", cc.tenure_months ? `${cc.tenure_months} Months` : "—", "Expected IRR", cc.expected_irr ? `${cc.expected_irr}% p.a.` : "—"],
      ["Industry", cc.industry ?? "—", "Constitution", (cc as any).legal_constitution ?? "—"],
      ["Status", String((cc as any).case_status ?? "—").replace(/_/g, " "), "Product Sub-type", (cc as any).product_type_custom ?? "—"],
    ];

    const tableRows = dealRows.map(row => [
      { text: row[0], options: { bold: true, color: C.navy, fill: { color: C.bgLight }, fontSize: 10.5, fontFace: "Calibri", wrap: true } },
      { text: truncate(row[1], 50), options: { color: C.ink, fontSize: 10.5, fontFace: "Calibri", fill: { color: C.cream }, wrap: true } },
      { text: row[2], options: { bold: true, color: C.navy, fill: { color: C.bgLight }, fontSize: 10.5, fontFace: "Calibri", wrap: true } },
      { text: truncate(row[3], 40), options: { color: C.ink, fontSize: 10.5, fontFace: "Calibri", fill: { color: C.cream }, wrap: true } },
    ]);

    s.addTable(tableRows as never, {
      x: 0.45, y: HEADER_H + 0.22, w: W - 0.9,
      rowH: 0.72,
      border: { pt: 0.75, color: C.border },
      colW: [2.5, 3.8, 2.5, 3.6],
    } as never);
  }

  // ── Slide 4: Company Profile ───────────────────────────────────────────────
  const SKIP_KEYS = new Set(["id", "created_at", "updated_at", "case_id", "org_id", "company_id", "user_id", "vector", "embedding", "search_vector"]);
  const KEY_LABELS: Record<string, string> = {
    name: "Legal Name", cin: "CIN", pan: "PAN", gstin: "GSTIN",
    legal_constitution: "Legal Constitution", category: "Category",
    sub_category: "Sub-Category", company_type: "Company Type",
    authorised_capital: "Authorised Capital", paid_up_capital: "Paid-Up Capital",
    status: "Status", sector: "Sector", products_services: "Products / Services",
    email: "Email", telephone: "Telephone", incorporation_date: "Incorporation Date",
    last_balance_sheet: "Last Balance Sheet", last_agm: "Last AGM",
    registered_address: "Registered Address",
  };

  if (company && Object.keys(company).length > 0) {
    const entries = Object.entries(company)
      .filter(([k, v]) => !SKIP_KEYS.has(k) && v != null && String(v).trim() !== "")
      .map(([k, v]) => [KEY_LABELS[k] ?? k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), String(v)]);

    if (entries.length > 0) {
      const s = pptx.addSlide();
      s.background = { color: C.cream };
      addHeader(s, "Company Profile", "MCA / Corpository Data", logoData);

      const tRows = entries.map(([ label, value], ri) => [
        { text: label, options: { bold: true, color: C.navy, fill: { color: C.bgLight }, fontSize: 9.5, fontFace: "Calibri", wrap: true } },
        { text: truncate(value, 110), options: { color: C.ink, fontSize: 9.5, fontFace: "Calibri", fill: { color: ri % 2 === 0 ? C.cream : C.bgLight }, wrap: true } },
      ]);

      s.addTable(tRows as never, {
        x: 0.45, y: HEADER_H + 0.18, w: W - 0.9,
        border: { pt: 0.5, color: C.border },
        colW: [3.3, 9.3],
        rowH: 0.31,
      } as never);
    }
  }

  // ── Slide 5: Directors ─────────────────────────────────────────────────────
  if (directors && directors.length > 0) {
    const s = pptx.addSlide();
    s.background = { color: C.cream };
    addHeader(s, "Directors & Key Persons", "Corporate Governance", logoData);

    const PREF = ["name", "din", "designation", "appointed", "shareholding", "age"];
    const allKeys = [...new Set(directors.flatMap(d => Object.keys(d)))].filter(k => !SKIP_KEYS.has(k));
    const cols = [...PREF.filter(k => allKeys.includes(k)), ...allKeys.filter(k => !PREF.includes(k))].slice(0, 6);
    const colLabels = cols.map(k => k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
    const firstW = 3.0;
    const restW = (W - 0.9 - firstW) / Math.max(cols.length - 1, 1);

    const header = colLabels.map((h, ci) => ({
      text: h,
      options: { bold: true, color: C.cream, fill: { color: C.navy }, fontSize: 9, fontFace: "Calibri", align: (ci === 0 ? "left" : "center") as "left" | "center", wrap: true },
    }));
    const dirRows = directors.map((d, ri) =>
      cols.map((k, ci) => ({
        text: truncate(String(d[k] ?? "—"), 35),
        options: { fontSize: 9, color: C.ink, fill: { color: ri % 2 === 0 ? C.cream : C.bgLight }, align: (ci === 0 ? "left" : "center") as "left" | "center", fontFace: "Calibri", wrap: true },
      })),
    );

    s.addTable([header, ...dirRows] as never, {
      x: 0.45, y: HEADER_H + 0.18, w: W - 0.9,
      border: { pt: 0.5, color: C.border },
      colW: [firstW, ...cols.slice(1).map(() => restW)],
    } as never);
  }

  // ── IC Sections + injected data slides ────────────────────────────────────
  const TYPE_TITLES: Record<string, string> = {
    profit_loss: "Profit & Loss Statement",
    balance_sheet: "Balance Sheet",
    cash_flow: "Cash Flow Statement",
    projections: "Projected Financials",
    all_in_one: "Financial Summary",
  };

  for (const sec of IC_SECTIONS) {
    const md = ic.sections?.[sec.id]?.markdown;
    const secLabel = `Section ${sec.roman} · ${sec.short}`;

    // ── After Section V: inject financial statement tables ─────────────────
    if (sec.id === "historical_financial" && extracted.length > 0) {
      const byType: Record<string, ExtractedRow[]> = {};
      for (const r of extracted) { (byType[r.statement_type ?? "other"] ??= []).push(r); }

      const ORDER = ["profit_loss", "balance_sheet", "cash_flow", "projections", "all_in_one"];
      const types = [...ORDER.filter(t => byType[t]), ...Object.keys(byType).filter(t => !ORDER.includes(t))];

      for (const stmtType of types) {
        const { labels, years: allYears, byLabel } = extractFinancialTable(byType[stmtType]);
        if (!labels.length || !allYears.length) continue;

        // Cap at MAX_YEARS (latest years)
        const years = allYears.slice(-MAX_YEARS);
        const headers = ["Particulars", ...years.map(y => `FY ${y}`)];
        const dataRows = labels.map(l => [
          truncate(l, 42),
          ...years.map(y => fmtNum(byLabel[l]?.[String(y)] ?? null)),
        ]);
        const colW = calcColW(years.length);
        const title = TYPE_TITLES[stmtType] ?? stmtType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        addTableSlide(pptx, logoData, title, `Section ${sec.roman} · Historical Financials`, headers, dataRows, colW);
      }
    }

    // ── After Section VII: inject ratio tables by category ─────────────────
    if (sec.id === "key_ratios" && ratios.length > 0) {
      const CAT_ORDER = ["coverage", "liquidity", "solvency", "profitability", "efficiency", "expenses", "r_score", "return"];
      const CAT_TITLES: Record<string, string> = {
        coverage: "Coverage Ratios", liquidity: "Liquidity Ratios",
        solvency: "Solvency Ratios", profitability: "Profitability Ratios",
        efficiency: "Efficiency & Turnover", expenses: "Expense Ratios",
        r_score: "R\' Score Components", return: "Return Ratios",
      };

      const byCategory: Record<string, RatioRow[]> = {};
      for (const r of ratios) { const cat = (r as any).category ?? "other"; (byCategory[cat] ??= []).push(r); }
      const cats = [...CAT_ORDER.filter(c => byCategory[c]), ...Object.keys(byCategory).filter(c => !CAT_ORDER.includes(c))];

      for (const cat of cats) {
        const catRatios = byCategory[cat];
        const allYears = [...new Set(catRatios.map((r: any) => Number(r.fiscal_year)).filter(Boolean))].sort();
        if (!allYears.length) continue;
        const years = allYears.slice(-MAX_YEARS);

        const byName: Record<string, { vals: Record<string, string>; bench: string }> = {};
        for (const r of catRatios as any[]) {
          const dn = RATIO_DISPLAY_NAMES[r.ratio_name] ?? r.ratio_name.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
          if (!byName[dn]) byName[dn] = { vals: {}, bench: "—" };
          const val = r.ratio_value != null ? Number(r.ratio_value).toFixed(2) : "—";
          const suffix = r.threshold_status === "green" ? " ✓" : r.threshold_status === "red" ? " ✗" : r.threshold_status === "amber" ? " !" : "";
          byName[dn].vals[String(r.fiscal_year)] = val + suffix;
          if (r.benchmark != null) byName[dn].bench = String(r.benchmark);
        }

        const names = Object.keys(byName);
        const headers = ["Ratio", ...years.map(y => `FY ${y}`), "Bench"];
        const dataRows = names.map(n => [truncate(n, 38), ...years.map(y => byName[n].vals[String(y)] ?? "—"), byName[n].bench]);
        const colW = calcColW(years.length, true);
        addTableSlide(pptx, logoData, CAT_TITLES[cat] ?? cat, `Section ${sec.roman} · Key Ratios`, headers, dataRows, colW);
      }
    }

    // ── Before Section X text: inject risk matrix ──────────────────────────
    if (sec.id === "risk_assessment" && ic.risks && ic.risks.length > 0) {
      const s = pptx.addSlide();
      s.background = { color: C.cream };
      addHeader(s, "Risk Assessment Matrix", `Section ${sec.roman} · Risks & Mitigants`, logoData);

      const header = ["Category", "Risk", "Mitigant", "Sev."].map((h, ci) => ({
        text: h,
        options: { bold: true, color: C.cream, fill: { color: C.navy }, fontSize: 8.5, fontFace: "Calibri", align: (ci < 3 ? "left" : "center") as "left" | "center", wrap: true },
      }));
      const riskRows = ic.risks.map((r, ri) => {
        const sevColor = r.severity === "HIGH" ? C.red : r.severity === "MEDIUM" ? C.amber : C.blue;
        const bg = ri % 2 === 0 ? C.cream : C.bgLight;
        return [
          { text: truncate(r.category, 22), options: { fontSize: 8.5, color: C.ink, fill: { color: bg }, fontFace: "Calibri", wrap: true } },
          { text: truncate(r.risk, 60), options: { fontSize: 8.5, color: C.ink, fill: { color: bg }, fontFace: "Calibri", wrap: true } },
          { text: truncate(r.mitigant, 70), options: { fontSize: 8.5, color: C.ink, fill: { color: bg }, fontFace: "Calibri", wrap: true } },
          { text: r.severity.slice(0, 3), options: { fontSize: 8.5, bold: true, color: sevColor, fill: { color: bg }, align: "center" as const, fontFace: "Calibri" } },
        ];
      });

      s.addTable([header, ...riskRows] as never, {
        x: 0.45, y: HEADER_H + 0.18, w: W - 0.9,
        rowH: 0.32,
        border: { pt: 0.5, color: C.border },
        colW: [2.0, 3.8, 4.9, 1.7],
      } as never);
    }

    // ── Markdown content (fall back to IC Deck section_templates) ─────────
    const tpl = (ic.section_templates as Record<string, SectionTemplate> | undefined)?.[sec.id];
    const blocks = md?.trim() ? parseBlocks(md) : (tpl ? templateToBlocks(tpl) : []);
    if (blocks.length) {
      addContentSlides(pptx, logoData, sec.title, secLabel, blocks, cc);
    }
  }

  // ── IC Deck-only sections (not in IC_SECTIONS) ───────────────────────────
  const deckOnlySections = [
    { id: "exec_recommendation",   roman: "XII",  title: "Executive Team Recommendation" },
    { id: "triangulation_analysis",roman: "XIV",  title: "Triangulation Analysis" },
  ];
  for (const sec of deckOnlySections) {
    const tpl = (ic.section_templates as Record<string, SectionTemplate> | undefined)?.[sec.id];
    if (!tpl) continue;
    const blocks = templateToBlocks(tpl);
    if (blocks.length) {
      addContentSlides(pptx, logoData, sec.title, `Section ${sec.roman}`, blocks, cc);
    }
  }

  // ── Conditions Precedent ──────────────────────────────────────────────────
  if (ic.conditions_precedent && ic.conditions_precedent.length > 0) {
    const s = pptx.addSlide();
    s.background = { color: C.cream };
    addHeader(s, "Conditions Precedent", "CP · Pre-Disbursement Requirements", logoData);

    const runs: PptxGenJS.TextProps[] = ic.conditions_precedent.flatMap((cp, i) => [
      { text: `${String(i + 1).padStart(2, "0")}.  `, options: { bold: true, fontSize: 11, color: C.navy, fontFace: "Georgia" } },
      { text: `${stripMd(cp)}\n`, options: { fontSize: 10.5, color: C.ink, fontFace: "Calibri" } },
    ]);
    s.addText(runs, { x: 0.45, y: HEADER_H + 0.22, w: W - 0.9, h: H - HEADER_H - 0.42, valign: "top", paraSpaceAfter: 8 } as never);
  }

  // ── SWOT Analysis ─────────────────────────────────────────────────────────
  if (ic.swot) {
    const s = pptx.addSlide();
    s.background = { color: C.cream };
    addHeader(s, "SWOT Analysis", "Strengths · Weaknesses · Opportunities · Threats", logoData);

    const qH = (H - HEADER_H - 0.36) / 2 - 0.12;
    const quads = [
      { label: "STRENGTHS",     items: ic.swot.strengths     ?? [], x: 0.3,  y: HEADER_H + 0.16, tColor: "166534", bg: "F0FDF4", border: "86EFAC" },
      { label: "WEAKNESSES",    items: ic.swot.weaknesses    ?? [], x: 6.87, y: HEADER_H + 0.16, tColor: "991B1B", bg: "FEF2F2", border: "FCA5A5" },
      { label: "OPPORTUNITIES", items: ic.swot.opportunities ?? [], x: 0.3,  y: HEADER_H + 0.16 + qH + 0.18, tColor: "1E40AF", bg: "EFF6FF", border: "93C5FD" },
      { label: "THREATS",       items: ic.swot.threats       ?? [], x: 6.87, y: HEADER_H + 0.16 + qH + 0.18, tColor: "92400E", bg: "FFFBEB", border: "FCD34D" },
    ] as const;

    for (const q of quads) {
      s.addShape("rect" as never, { x: q.x, y: q.y, w: 6.28, h: qH, fill: { color: q.bg }, line: { color: q.border, width: 1.2 } } as never);
      s.addText(q.label, { x: q.x + 0.17, y: q.y + 0.08, w: 5.9, h: 0.3, fontSize: 9, bold: true, color: q.tColor, fontFace: "Georgia", charSpacing: 2 } as never);
      const bullets = q.items.slice(0, 6).map(item => `• ${truncate(stripMd(item), 80)}`).join("\n");
      s.addText(bullets || "—", { x: q.x + 0.17, y: q.y + 0.43, w: 5.9, h: qH - 0.5, fontSize: 9.5, color: C.ink, fontFace: "Calibri", valign: "top", paraSpaceAfter: 2 } as never);
    }
  }

  // ── AI Analysis Slides ────────────────────────────────────────────────────
  const ai = (ic as any).ai_review_analysis;
  if (ai) {
    if (ai.cfo_flags?.length > 0) {
      const s = pptx.addSlide();
      s.background = { color: C.cream };
      addHeader(s, "CFO Flags", "AI Financial Analysis · Gemini Auto-Generated", logoData);

      const header = ["Flag", "Sev.", "Detail"].map((h, ci) => ({
        text: h,
        options: { bold: true, color: C.cream, fill: { color: C.navy }, fontSize: 8.5, fontFace: "Calibri", align: (ci === 1 ? "center" : "left") as "center" | "left", wrap: true },
      }));
      const rows = (ai.cfo_flags as { flag: string; severity: string; detail: string }[]).map((f, ri) => {
        const sevColor = f.severity === "HIGH" ? C.red : f.severity === "MEDIUM" ? C.amber : C.blue;
        const bg = ri % 2 === 0 ? C.cream : C.bgLight;
        return [
          { text: truncate(f.flag, 40), options: { fontSize: 8.5, bold: true, color: C.ink, fill: { color: bg }, fontFace: "Calibri", wrap: true } },
          { text: f.severity.slice(0, 3), options: { fontSize: 8.5, bold: true, color: sevColor, align: "center" as const, fill: { color: bg }, fontFace: "Calibri" } },
          { text: truncate(f.detail, 130), options: { fontSize: 8.5, color: C.ink, fill: { color: bg }, fontFace: "Calibri", wrap: true } },
        ];
      });
      s.addTable([header, ...rows] as never, {
        x: 0.45, y: HEADER_H + 0.18, w: W - 0.9,
        rowH: 0.32,
        border: { pt: 0.5, color: C.border },
        colW: [3.5, 0.95, 7.98],
      } as never);
    }

    if (ai.analyst_summary) {
      addContentSlides(pptx, logoData, "Financial Analyst Summary", "AI Analysis · Gemini Auto-Generated", parseBlocks(String(ai.analyst_summary)));
    }
    if (ai.fiscal_report) {
      addContentSlides(pptx, logoData, "Fiscal Report", "AI Analysis · Gemini Auto-Generated", parseBlocks(String(ai.fiscal_report)));
    }
  }

  // ── Closing Slide ─────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: C.navy };
    s.addShape("rect" as never, { x: 0, y: H - 0.09, w: W, h: 0.09, fill: { color: C.goldLt }, line: { color: C.goldLt } } as never);

    if (logoData) {
      s.addImage({ data: logoData, x: (W - 4.5) / 2, y: 0.9, w: 4.5, h: 1.4 } as never);
    }
    s.addText("This presentation is strictly confidential and prepared\nfor internal Investment Committee use only.", {
      x: 1.5, y: 2.8, w: W - 3, h: 0.85,
      fontSize: 12, color: C.cream, align: "center", fontFace: "Calibri", transparency: 20,
    } as never);
    s.addText(borrowerName, { x: 0, y: 3.78, w: W, h: 0.42, fontSize: 12, color: C.goldLt, align: "center", fontFace: "Georgia" } as never);
    s.addText("© Rehbar Financial Services  ·  rehbar.co.in", {
      x: 0, y: H - 0.57, w: W, h: 0.3,
      fontSize: 8.5, color: C.cream, align: "center", fontFace: "Calibri", transparency: 35,
    } as never);
  }

  // ── Write file ────────────────────────────────────────────────────────────
  const safeName = borrowerName.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 40);
  await pptx.writeFile({ fileName: `IC_Note_${safeName}_${new Date().toISOString().slice(0, 10)}.pptx` });
}
