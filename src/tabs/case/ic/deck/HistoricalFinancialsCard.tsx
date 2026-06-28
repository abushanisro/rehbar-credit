import React from "react";
import { SlideShell } from "./SlideShell";
import type { ExtractedRow } from "@/features/case/types";
import { icGetItems, icLiVal, icFmt } from "@/tabs/case/ic/ICComponents";

const DS = {
  navy:    "#0F1B2D",
  gold:    "#F5C518",
  altRow:  "#F5F5F0",
  body:    "#1C1C1E",
  muted:   "#888888",
  green:   "#15803D",
  red:     "#B91C1C",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

interface RowItem { label: string; text?: string; items?: string[] }
interface SectionTemplate { rows?: RowItem[]; headline?: string; bullets?: string[]; flags?: string[]; generated_at?: string }

interface HistoricalFinancialsCardProps {
  extracted: ExtractedRow[];
  pageNumStart: number;
  template?: SectionTemplate;
  generating?: boolean;
  onGenerate?: () => void;
}

type RawItem = { label: string; value: number | null; override_value?: number | null };

// ── Unit scaling ──────────────────────────────────────────────────────────────
function scaleToDisplay(v: number | null, unit: string | null): number | null {
  if (v === null) return null;
  const u = (unit ?? "").toLowerCase();
  if (u.includes("lakh") || u.includes("crore") || u.includes("million") || u.includes("thousand")) return v;
  return v / 100000;
}

function resolvedUnitLabel(unit: string | null): string {
  if (!unit) return "₹ Lakhs";
  const u = unit.toLowerCase();
  if (u.includes("lakh")) return "₹ Lakhs";
  if (u.includes("crore")) return "₹ Crores";
  if (u.includes("million")) return "USD Millions";
  if (u.includes("thousand")) return "₹ Thousands";
  return "₹ Lakhs";
}

// ── YoY % ─────────────────────────────────────────────────────────────────────
function yoyPct(curr: number | null, prev: number | null): React.ReactNode {
  if (curr == null || prev == null || prev === 0) return <span style={{ color: DS.muted }}>—</span>;
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  const sign = pct > 0 ? "+" : "";
  const color = pct > 0 ? DS.green : pct < 0 ? DS.red : DS.muted;
  return <span style={{ color, fontWeight: 500 }}>{sign}{pct.toFixed(1)}%</span>;
}

// ── Get all unique labels from rows of a given statement_type ─────────────────
function getDynamicLabels(rows: ExtractedRow[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const row of rows) {
    for (const item of (row.line_items as unknown as RawItem[]) ?? []) {
      if (item.label && !seen.has(item.label)) {
        seen.add(item.label);
        labels.push(item.label);
      }
    }
  }
  return labels;
}

// ── Get value for a label directly from raw rows ──────────────────────────────
function getRawVal(rows: ExtractedRow[], fy: number, label: string): number | null {
  for (const row of rows.filter(r => r.fiscal_year === fy)) {
    const items = (row.line_items as unknown as RawItem[]) ?? [];
    const item = items.find(i => i.label === label);
    if (item) {
      const v = item.override_value !== undefined && item.override_value !== null ? item.override_value : item.value;
      if (v !== null) return scaleToDisplay(Number(v), row.unit);
    }
  }
  return null;
}

// ── Generic dynamic financial table ──────────────────────────────────────────
interface DynTableProps {
  roman: string;
  title: string;
  pageNum: number;
  years: number[];
  rows: ExtractedRow[];        // rows for this statement type
  allRows: ExtractedRow[];     // all non-projection rows (for fallback labels)
  fallbackLabels?: string[];   // used if no typed rows found
}

function DynTable({ roman, title, pageNum, years, rows, allRows, fallbackLabels }: DynTableProps) {
  const shownYears = years.slice(-5);
  const lastTwo = shownYears.slice(-2);

  // Determine labels
  const useFallback = rows.length === 0;
  const rawLabels = useFallback ? (fallbackLabels ?? []) : getDynamicLabels(rows);

  // Filter to labels with at least one non-null value
  const activeLabels = rawLabels.filter(label =>
    shownYears.some(y => {
      const v = useFallback
        ? (() => { const items = icGetItems(allRows.concat(/* projected filtered out above */[]), y); return icLiVal(items, label); })()
        : getRawVal(rows, y, label);
      return v !== null;
    })
  );

  const getVal = (label: string, fy: number): number | null => {
    if (useFallback) {
      const items = icGetItems(allRows, fy);
      return scaleToDisplay(icLiVal(items, label), allRows.find(r => r.fiscal_year === fy)?.unit ?? null);
    }
    return getRawVal(rows, fy, label);
  };

  const rawUnit = rows.find(r => r.unit)?.unit ?? allRows.find(r => r.unit)?.unit ?? null;
  const unitLabel = resolvedUnitLabel(rawUnit).replace(/^[₹\s]+/, "");

  return (
    <SlideShell roman={roman} title={`${title} (₹ ${unitLabel})`} pageNum={pageNum}>
      <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>
        {activeLabels.length === 0 ? (
          <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 11, color: DS.muted, fontStyle: "italic" }}>
            No data available
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: DS.gold }}>
                <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: DS.body, width: "30%" }}>Item</th>
                {shownYears.map(y => (
                  <th key={y} style={{ padding: "7px 10px", textAlign: "right", fontSize: 10, fontWeight: 700, color: DS.body }}>FY{y}</th>
                ))}
                {shownYears.length >= 2 && (
                  <th style={{ padding: "7px 10px", textAlign: "right", fontSize: 10, fontWeight: 700, color: DS.body }}>YoY%</th>
                )}
              </tr>
            </thead>
            <tbody>
              {activeLabels.map((label, i) => {
                const vals = shownYears.map(y => getVal(label, y));
                const curr = lastTwo.length >= 2 ? getVal(label, lastTwo[1]) : null;
                const prev = lastTwo.length >= 2 ? getVal(label, lastTwo[0]) : null;
                return (
                  <tr key={label} style={{ background: i % 2 === 0 ? "#FFFFFF" : DS.altRow }}>
                    <td style={{ padding: "7px 12px", fontSize: 11, color: DS.body, borderBottom: "1px solid #EBEBEB" }}>{label}</td>
                    {vals.map((v, vi) => (
                      <td key={vi} style={{ padding: "7px 10px", textAlign: "right", fontSize: 11, color: DS.body, borderBottom: "1px solid #EBEBEB", fontVariantNumeric: "tabular-nums" }}>
                        {icFmt(v)}
                      </td>
                    ))}
                    {shownYears.length >= 2 && (
                      <td style={{ padding: "7px 10px", textAlign: "right", fontSize: 11, borderBottom: "1px solid #EBEBEB" }}>
                        {yoyPct(curr, prev)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </SlideShell>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function HistoricalFinancialsCard({ extracted, pageNumStart, template, generating, onGenerate }: HistoricalFinancialsCardProps) {
  const histRows = extracted.filter(r => r.statement_type !== "projections");
  const histYears = Array.from(new Set(histRows.map(r => r.fiscal_year))).sort();

  // Statement-type specific rows
  const plRows = histRows.filter(r => r.statement_type === "profit_loss");
  const bsRows = histRows.filter(r => r.statement_type === "balance_sheet");

  // Fallback labels when no typed rows exist (e.g. all_in_one uploads)
  const PL_FALLBACK = ["Turnover", "Cost of Goods Sold", "Gross Profit", "Operating Expenses", "EBITDA", "Depreciation", "EBIT", "Interest Expense", "Profit Before Tax", "Tax", "PAT"];
  const BS_FALLBACK = ["Share Capital", "Reserves & Surplus", "Net Worth", "Long Term Borrowings", "Short Term Borrowings", "Total Debt", "Trade Payables", "Current Liabilities", "Fixed Assets (Net)", "Inventory", "Trade Receivables", "Cash & Bank", "Current Assets", "Total Assets"];

  // Projected rows
  const projRows = extracted.filter(r => r.statement_type === "projections").sort((a, b) => a.fiscal_year - b.fiscal_year);
  const projYears = projRows.map(r => r.fiscal_year);

  const getProjData = (label: string, fy: number): number | null => {
    const row = projRows.find(r => r.fiscal_year === fy);
    if (!row) return null;
    const items = (row.line_items as unknown as { label: string; value: number | null; override_value?: number | null }[]) ?? [];
    const ALIASES: Record<string, string[]> = {
      "Projected Turnover":   ["Projected Turnover", "Projected Revenue", "Revenue", "Total Income", "Turnover", "Net Sales"],
      "Projected EBITDA":     ["Projected EBITDA", "EBITDA", "Projected Gross Profit", "Gross Profit"],
      "Projected PAT":        ["Projected PAT", "Projected Net Profit", "PAT", "Net Profit", "Projected Profit Before Tax", "PBT"],
      "Projected Net Worth":  ["Projected Net Worth", "Net Worth", "Shareholders Equity", "Total Equity"],
      "Projected Total Debt": ["Projected Total Debt", "Total Debt", "Projected LT Borrowings", "Projected ST Borrowings"],
    };
    const aliases = ALIASES[label] ?? [label];
    for (const alias of aliases) {
      const it = items.find(i => i.label === alias);
      if (it) {
        const v = it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
        if (v !== null) return Number(v);
      }
    }
    return null;
  };

  return (
    <>
      {/* V-a: Profit & Loss */}
      <DynTable
        roman="V-a"
        title="Historical Financials – Profit & Loss"
        pageNum={pageNumStart}
        years={histYears}
        rows={plRows}
        allRows={histRows}
        fallbackLabels={PL_FALLBACK}
      />

      {/* V-b: Balance Sheet */}
      <DynTable
        roman="V-b"
        title="Historical Financials – Balance Sheet"
        pageNum={pageNumStart + 1}
        years={histYears}
        rows={bsRows}
        allRows={histRows}
        fallbackLabels={BS_FALLBACK}
      />

      {/* V-c: Projected Financials */}
      <SlideShell roman="V-c" title="Projected Financials (₹ Lakhs)" pageNum={pageNumStart + 2}>
        <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>
          {projYears.length === 0 ? (
            <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 11, color: DS.muted, fontStyle: "italic" }}>
              No projection data available. Upload projections to view.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: DS.gold }}>
                  <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: DS.body, width: "30%" }}>Metric</th>
                  {projYears.map(y => (
                    <th key={y} style={{ padding: "7px 10px", textAlign: "right", fontSize: 10, fontWeight: 700, color: DS.body }}>FY{y} (P)</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {["Projected Turnover", "Projected EBITDA", "Projected PAT", "Projected Net Worth", "Projected Total Debt"].map((label, i) => (
                  <tr key={label} style={{ background: i % 2 === 0 ? "#FFFFFF" : DS.altRow }}>
                    <td style={{ padding: "7px 12px", fontSize: 11, color: DS.body, borderBottom: "1px solid #EBEBEB" }}>{label}</td>
                    {projYears.map((y, vi) => (
                      <td key={vi} style={{ padding: "7px 10px", textAlign: "right", fontSize: 11, color: DS.body, borderBottom: "1px solid #EBEBEB", fontVariantNumeric: "tabular-nums" }}>
                        {icFmt(getProjData(label, y))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SlideShell>

      {/* V-d: Narrative Commentary */}
      <SlideShell
        roman="V-d"
        title="Historical Financial Analysis – Commentary"
        pageNum={pageNumStart + 3}
        generating={generating}
        onGenerate={template ? onGenerate : undefined}
      >
        {template?.generated_at ? (
          <div style={{ fontFamily: DS.bodyFont }}>
            {/* Rows format (new) */}
            {template.rows && template.rows.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {template.rows.map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #E8E8E4", background: i % 2 === 0 ? "#FFFFFF" : DS.altRow }}>
                      <td style={{ width: "22%", padding: "10px 16px", fontSize: 10.5, fontWeight: 700, color: DS.navy, verticalAlign: "top", borderRight: "1px solid #E8E8E4", lineHeight: 1.5 }}>
                        {row.label}
                      </td>
                      <td style={{ padding: "10px 16px", fontSize: 11, color: DS.body, verticalAlign: "top", lineHeight: 1.65 }}>
                        {row.items && row.items.length > 0
                          ? <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>{row.items.map((item, j) => <li key={j} style={{ display: "flex", gap: 8, marginBottom: 4 }}><span style={{ color: DS.navy, fontWeight: 700, flexShrink: 0 }}>▸</span><span>{item}</span></li>)}</ul>
                          : (row.text ?? "").split("\n").map((line, k, arr) => <span key={k}>{line}{k < arr.length - 1 && <br />}</span>)
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {/* Legacy bullet format */}
            {!(template.rows?.length) && (template.headline || template.bullets?.length) && (
              <div style={{ padding: "20px 24px" }}>
                {template.headline && <div style={{ fontSize: 13, fontStyle: "italic", color: DS.body, marginBottom: 12 }}>{template.headline}</div>}
                {(template.bullets ?? []).map((b, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <span style={{ color: DS.navy, fontWeight: 700, flexShrink: 0 }}>•</span>
                    <span style={{ fontSize: 11, color: DS.body, lineHeight: 1.7 }}>{b}</span>
                  </div>
                ))}
              </div>
            )}
            {/* Flags */}
            {(template.flags ?? []).length > 0 && (
              <div style={{ borderTop: "1px solid #E8E8E4", padding: "10px 16px", background: "#FFFBF0" }}>
                {(template.flags ?? []).map((f, i) => (
                  <div key={i} style={{ fontSize: 10.5, color: "#B45309", marginBottom: 4, display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.55 }}>
                    <span style={{ flexShrink: 0 }}>⚠</span><span>{f}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: "20px 24px 16px", fontFamily: DS.bodyFont }}>
            <div style={{ minHeight: 160, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
              <p style={{ fontSize: 11, fontStyle: "italic", color: DS.muted, textAlign: "center" }}>
                Click Generate to fill this section
              </p>
              {onGenerate && (
                <button
                  onClick={onGenerate}
                  disabled={generating}
                  style={{ background: DS.navy, color: "#FFFFFF", border: "none", borderRadius: 16, padding: "8px 20px", fontSize: 12, fontFamily: DS.bodyFont, cursor: generating ? "not-allowed" : "pointer", opacity: generating ? 0.7 : 1 }}
                >
                  {generating ? "Generating…" : "✦ Generate"}
                </button>
              )}
            </div>
          </div>
        )}
      </SlideShell>
    </>
  );
}
