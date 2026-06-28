import React from "react";
import { SlideShell } from "./SlideShell";
import type { ExtractedRow } from "@/features/case/types";

const DS = {
  navy:    "#0F1B2D",
  gold:    "#F5C518",
  altRow:  "#F5F5F0",
  body:    "#1C1C1E",
  muted:   "#888888",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

type LineItem = { label: string; value: number | null; override_value?: number | null };

interface ProvPeriod {
  id: string;
  label: string;
  period_type: string;
  fiscal_year: number;
  months_covered: number;
  unit: string;
  pl: LineItem[];
  bs: LineItem[];
  cf: LineItem[];
}

interface ProjectionsCardProps {
  extracted: ExtractedRow[];
  provisional: ProvPeriod[] | undefined | null;
  comment: string | undefined | null;
  pageNum: number;
}

// All label lists matching ProvisionalTab exactly
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
  "Cash from Operations", "Cash from Investing", "Cash from Financing",
  "Net Change in Cash", "Opening Cash", "Closing Cash",
];

const PROJ_ALIASES: Record<string, string[]> = {
  "Turnover":   ["Projected Turnover", "Projected Revenue", "Revenue", "Total Income", "Turnover", "Net Sales"],
  "EBITDA":     ["Projected EBITDA", "EBITDA"],
  "PAT":        ["Projected PAT", "Projected Net Profit", "PAT", "Net Profit"],
  "Net Worth":  ["Projected Net Worth", "Net Worth", "Shareholders Equity", "Total Equity"],
  "Total Debt": ["Projected Total Debt", "Total Debt"],
};

function getItemVal(items: LineItem[], label: string): number | null {
  const it = items.find(i => i.label === label);
  if (!it) return null;
  const v = it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
  return v !== null ? Number(v) : null;
}

function resolveAlias(items: LineItem[], aliases: string[]): number | null {
  for (const alias of aliases) {
    const it = items.find(i => i.label === alias);
    if (it) {
      const v = it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
      if (v !== null) return Number(v);
    }
  }
  return null;
}

function icFmt(v: number | null): string {
  if (v === null) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function pctFmt(num: number | null, den: number | null): string {
  if (num === null || den === null || den === 0) return "—";
  return ((num / den) * 100).toFixed(1) + "%";
}

// ── Sub-table component ────────────────────────────────────────────────────────
interface ProvTableProps {
  sectionTitle: string;
  periods: ProvPeriod[];
  labels: string[];
  getVal: (period: ProvPeriod, label: string) => number | null;
}

function ProvTable({ sectionTitle, periods, labels, getVal }: ProvTableProps) {
  // Only show rows that have at least one non-null value
  const activeLabels = labels.filter(label =>
    periods.some(p => getVal(p, label) !== null)
  );
  if (activeLabels.length === 0) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: DS.muted, letterSpacing: "0.08em", textTransform: "uppercase", margin: "14px 20px 8px" }}>
        {sectionTitle}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: DS.gold }}>
            <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: DS.body, width: "26%" }}>
              Line Item
            </th>
            {periods.map(p => (
              <th key={p.id} style={{ padding: "7px 10px", textAlign: "right", fontSize: 10, fontWeight: 700, color: DS.body }}>
                {p.label || `FY${p.fiscal_year}`}
                {p.months_covered ? <span style={{ display: "block", fontSize: 8, fontWeight: 400, color: "#4A3800" }}>₹ Lakhs · {p.months_covered}M</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {activeLabels.map((label, i) => (
            <tr key={label} style={{ background: i % 2 === 0 ? "#FFFFFF" : DS.altRow }}>
              <td style={{ padding: "7px 12px", fontSize: 11, color: DS.body, borderBottom: "1px solid #EBEBEB" }}>{label}</td>
              {periods.map((p, vi) => (
                <td key={vi} style={{ padding: "7px 10px", textAlign: "right", fontSize: 11, color: DS.body, borderBottom: "1px solid #EBEBEB", fontVariantNumeric: "tabular-nums" }}>
                  {icFmt(getVal(p, label))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function ProjectionsCard({ extracted, provisional, comment, pageNum }: ProjectionsCardProps) {
  // Projected rows from extracted financials
  const projRows = extracted
    .filter(r => r.statement_type === "projections")
    .sort((a, b) => a.fiscal_year - b.fiscal_year);
  const projYears = projRows.map(r => r.fiscal_year);

  const getProjVal = (metricKey: string, fy: number): number | null => {
    const row = projRows.find(r => r.fiscal_year === fy);
    if (!row) return null;
    const items = (row.line_items as unknown as LineItem[]) ?? [];
    return resolveAlias(items, PROJ_ALIASES[metricKey] ?? [metricKey]);
  };

  // Provisional periods sorted
  const provPeriods = (provisional ?? []).sort((a, b) => a.fiscal_year - b.fiscal_year);

  const hasProjections = projYears.length > 0;
  const hasProvisional = provPeriods.length > 0;
  const hasComment = !!(comment && comment.trim());
  const isEmpty = !hasProjections && !hasProvisional && !hasComment;

  return (
    <SlideShell roman="VI" title="Projections & Estimates" pageNum={pageNum}>
      <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>
        {isEmpty ? (
          <div style={{ padding: "40px 24px", textAlign: "center", fontSize: 11, color: DS.muted, fontStyle: "italic" }}>
            No projection or provisional data available. Upload projections or fill in the Provisional tab to populate this section.
          </div>
        ) : (
          <>
            {/* ── Projected Financials ─────────────────────────────────────── */}
            {hasProjections && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: DS.muted, letterSpacing: "0.08em", textTransform: "uppercase", margin: "14px 20px 8px" }}>
                  Projected Financials (₹ Lakhs)
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: DS.gold }}>
                      <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: DS.body, width: "26%" }}>Metric</th>
                      {projYears.map(y => (
                        <th key={y} style={{ padding: "7px 10px", textAlign: "right", fontSize: 10, fontWeight: 700, color: DS.body }}>FY{y} (P)</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(["Turnover", "EBITDA", "PAT", "Net Worth", "Total Debt"] as const).map((metric, i) => (
                      <tr key={metric} style={{ background: i % 2 === 0 ? "#FFFFFF" : DS.altRow }}>
                        <td style={{ padding: "7px 12px", fontSize: 11, color: DS.body, borderBottom: "1px solid #EBEBEB" }}>{metric}</td>
                        {projYears.map((y, vi) => (
                          <td key={vi} style={{ padding: "7px 10px", textAlign: "right", fontSize: 11, color: DS.body, borderBottom: "1px solid #EBEBEB", fontVariantNumeric: "tabular-nums" }}>
                            {icFmt(getProjVal(metric, y))}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr style={{ background: "#FFFFFF" }}>
                      <td style={{ padding: "7px 12px", fontSize: 11, color: DS.muted, borderBottom: "1px solid #EBEBEB", fontStyle: "italic" }}>EBITDA %</td>
                      {projYears.map((y, vi) => (
                        <td key={vi} style={{ padding: "7px 10px", textAlign: "right", fontSize: 11, color: DS.muted, borderBottom: "1px solid #EBEBEB", fontStyle: "italic" }}>
                          {pctFmt(getProjVal("EBITDA", y), getProjVal("Turnover", y))}
                        </td>
                      ))}
                    </tr>
                    <tr style={{ background: DS.altRow }}>
                      <td style={{ padding: "7px 12px", fontSize: 11, color: DS.muted, borderBottom: "1px solid #EBEBEB", fontStyle: "italic" }}>PAT %</td>
                      {projYears.map((y, vi) => (
                        <td key={vi} style={{ padding: "7px 10px", textAlign: "right", fontSize: 11, color: DS.muted, borderBottom: "1px solid #EBEBEB", fontStyle: "italic" }}>
                          {pctFmt(getProjVal("PAT", y), getProjVal("Turnover", y))}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Provisional P&L ──────────────────────────────────────────── */}
            {hasProvisional && (
              <ProvTable
                sectionTitle="Provisional P&L (₹ Lakhs)"
                periods={provPeriods}
                labels={PL_LABELS}
                getVal={(p, label) => getItemVal(p.pl, label)}
              />
            )}

            {/* ── Provisional Balance Sheet ─────────────────────────────────── */}
            {hasProvisional && (
              <ProvTable
                sectionTitle="Provisional Balance Sheet (₹ Lakhs)"
                periods={provPeriods}
                labels={BS_LABELS}
                getVal={(p, label) => getItemVal(p.bs, label)}
              />
            )}

            {/* ── Provisional Cash Flow ─────────────────────────────────────── */}
            {hasProvisional && (
              <ProvTable
                sectionTitle="Provisional Cash Flow (₹ Lakhs)"
                periods={provPeriods}
                labels={CF_LABELS}
                getVal={(p, label) => getItemVal(p.cf ?? [], label)}
              />
            )}

            {/* ── Analyst Commentary ──────────────────────────────────────────── */}
            {hasComment && (
              <div style={{ margin: "0 20px 16px", padding: "10px 14px", background: DS.altRow, borderLeft: `3px solid ${DS.navy}`, borderRadius: "0 3px 3px 0" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: DS.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>
                  Analyst Commentary
                </div>
                <div style={{ fontSize: 11, color: DS.body, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                  {comment}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </SlideShell>
  );
}
