import React from "react";
import { SlideShell } from "./SlideShell";
import type { ExtractedRow } from "@/features/case/types";

const DS = {
  navy:    "#0F1B2D",
  gold:    "#F5C518",
  altRow:  "#F5F5F0",
  body:    "#1C1C1E",
  muted:   "#888888",
  green:   "#15803D",
  amber:   "#B45309",
  red:     "#B91C1C",
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
  note?: { headline: string; bullets: string[]; flags: string[]; generated_at: string } | null;
  generating?: boolean;
  onGenerate?: () => void;
  pageNum: number;
}

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

// Historical aliases (same label names used in P&L and B/S)
const HIST_ALIASES: Record<string, string[]> = {
  "Turnover":   ["Turnover", "Total Revenue from Operations", "Revenue", "Net Sales", "Total Income"],
  "EBITDA":     ["EBITDA", "Earnings before Interest Tax and Depreciation"],
  "PAT":        ["PAT", "Profit After Tax", "Net Profit"],
  "Net Worth":  ["Net Worth", "Shareholders Equity", "Total Equity"],
  "Total Debt": ["Total Debt", "Total Borrowings"],
};

// Convert stored value to lakhs based on unit field
function toL(v: number | null, unit: string): number | null {
  if (v === null) return null;
  const u = unit.toLowerCase();
  if (u === "inr" || u === "rupees" || u === "rs") return v / 1e5;
  if (u === "crores" || u === "crore") return v * 100;
  if (u === "thousands") return v / 100;
  return v; // already lakhs
}

function getItemVal(items: LineItem[], label: string, unit = "Lakhs"): number | null {
  const it = items.find(i => i.label === label);
  if (!it) return null;
  const v = it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
  return v !== null ? toL(Number(v), unit) : null;
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

function cagrFmt(first: number | null, last: number | null, years: number): string {
  if (first === null || last === null || first <= 0 || years <= 0) return "—";
  const cagr = (Math.pow(last / first, 1 / years) - 1) * 100;
  if (!isFinite(cagr)) return "—";
  const sign = cagr >= 0 ? "+" : "";
  return `${sign}${cagr.toFixed(1)}%`;
}

// ── Damped-Trend Holt-Winters Smoothing ──────────────────────────────────────
// phi < 1 damps the trend so it doesn't extrapolate linearly to infinity.
// With small samples (n < 4) we blend the trend toward the long-run
// sustainable growth rate and widen CI to reflect low confidence.
interface HWResult {
  forecast: number[];
  ciHigh: number[];
  ciLow: number[];
  mape: number | null;        // in-sample MAPE (accuracy metric)
  confidence: "high" | "medium" | "low" | "very-low";
}

function holtwinters(
  series: number[],
  horizon: number,
  alpha = 0.4,
  beta  = 0.2,
  phi   = 0.88,               // damping: 0.88 means trend decays ~35% by year 3
): HWResult {
  const n = series.length;
  const empty: HWResult = { forecast: [], ciHigh: [], ciLow: [], mape: null, confidence: "very-low" };
  if (n === 0) return empty;

  const confidence: HWResult["confidence"] =
    n >= 5 ? "high" : n >= 4 ? "medium" : n >= 3 ? "low" : "very-low";

  // Sustainable long-run annual growth rate (blend target)
  // Industries rarely sustain >30% long-term; we blend toward this
  const SUSTAINABLE_GROWTH = 0.20;

  if (n === 1) {
    const v = series[0];
    const ciWidth = Math.abs(v) * 0.30;
    return {
      forecast: Array(horizon).fill(v * (1 + SUSTAINABLE_GROWTH)),
      ciHigh:   Array(horizon).fill(v * (1 + SUSTAINABLE_GROWTH) + ciWidth),
      ciLow:    Array(horizon).fill(Math.max(0, v * (1 + SUSTAINABLE_GROWTH) - ciWidth)),
      mape: null, confidence,
    };
  }

  // Initialise: use OLS slope for initial trend if >=3 points, else single diff
  let initTrend: number;
  if (n >= 3) {
    const xs = series.map((_, i) => i - (n - 1) / 2);
    const ys = series;
    const ssxy = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const ssxx = xs.reduce((s, x) => s + x * x, 0);
    initTrend = ssxx > 0 ? ssxy / ssxx : series[1] - series[0];
  } else {
    initTrend = series[1] - series[0];
  }

  // Cap initial trend so single-year outlier jumps don't dominate
  // Allow at most 60% of last value as the absolute trend magnitude
  const trendCap = Math.abs(series.at(-1)!) * 0.60;
  initTrend = Math.max(-trendCap, Math.min(trendCap, initTrend));

  let level = series[0];
  let trend = initTrend;

  const fitted: number[] = [];
  const absErrPct: number[] = [];

  for (let i = 1; i < n; i++) {
    const prevLevel = level;
    const prevTrend = trend;
    level = alpha * series[i] + (1 - alpha) * (prevLevel + phi * prevTrend);
    trend = beta  * (level - prevLevel) + (1 - beta) * phi * prevTrend;
    const fit = level + phi * trend;
    fitted.push(fit);
    if (series[i] !== 0) absErrPct.push(Math.abs((series[i] - fit) / series[i]) * 100);
  }

  const mape = absErrPct.length > 0
    ? absErrPct.reduce((s, e) => s + e, 0) / absErrPct.length
    : null;

  // ── Residual std for CI ──────────────────────────────────────────────────
  const residuals = series.slice(1).map((v, i) => v - fitted[i]);
  const resMean = residuals.reduce((s, r) => s + r, 0) / Math.max(residuals.length, 1);
  const resVariance = residuals.reduce((s, r) => s + Math.pow(r - resMean, 2), 0) / Math.max(residuals.length, 1);
  let resStd = Math.sqrt(resVariance);

  // Floor: CI must be at least 15% of the last actual value (small sample minimum uncertainty)
  const ciFloor = Math.abs(series.at(-1)!) * (confidence === "very-low" ? 0.35 : confidence === "low" ? 0.25 : confidence === "medium" ? 0.18 : 0.12);
  resStd = Math.max(resStd, ciFloor);

  // For very-low confidence (only 2 pts), blend forecast toward sustainable rate
  // Weight: 50% model, 50% sustainable growth from last actual
  const blendWeight = confidence === "very-low" ? 0.50 : confidence === "low" ? 0.25 : 0.05;

  const Z90 = 1.645;
  const forecast: number[] = [];
  const ciHigh: number[] = [];
  const ciLow:  number[] = [];

  let dampedTrendSum = 0;
  const lastActual = series.at(-1)!;

  for (let h = 1; h <= horizon; h++) {
    dampedTrendSum += Math.pow(phi, h);
    const modelF = level + dampedTrendSum * trend;
    // Sustainable growth alternative
    const sustF = lastActual * Math.pow(1 + SUSTAINABLE_GROWTH, h);
    // Blended forecast
    const f = (1 - blendWeight) * modelF + blendWeight * sustF;
    forecast.push(f);
    // CI widens with horizon and is wider for low-confidence models
    const margin = Z90 * resStd * Math.sqrt(h) * (confidence === "very-low" ? 1.5 : 1.0);
    ciHigh.push(f + margin);
    ciLow.push(Math.max(0, f - margin));
  }

  return { forecast, ciHigh, ciLow, mape, confidence };
}

// ── Sub-table component ────────────────────────────────────────────────────────
interface ProvTableProps {
  sectionTitle: string;
  periods: ProvPeriod[];
  labels: string[];
  getVal: (period: ProvPeriod, label: string, unit: string) => number | null;
}

function ProvTable({ sectionTitle, periods, labels, getVal }: ProvTableProps) {
  const activeLabels = labels.filter(label => periods.some(p => getVal(p, label, p.unit ?? "Lakhs") !== null));
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
                  {icFmt(getVal(p, label, p.unit ?? "Lakhs"))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── AI Estimates block ────────────────────────────────────────────────────────
const AI_METRICS = ["Turnover", "EBITDA", "PAT", "Net Worth", "Total Debt"] as const;

interface AiRow {
  label: string;
  histSeries: number[];
  forecast: number[];
  ciHigh: number[];
  ciLow:  number[];
  mape: number | null;
  ebitdaPct: number[] | null;
  patPct: number[] | null;
}

interface AiEstimatesBlockProps {
  extracted: ExtractedRow[];
  horizonYears: number;
}

function AiEstimatesBlock({ extracted, horizonYears }: AiEstimatesBlockProps) {
  const histRows = extracted
    .filter(r => r.statement_type === "profit_loss" || r.statement_type === "balance_sheet")
    .sort((a, b) => a.fiscal_year - b.fiscal_year);

  const years = [...new Set(histRows.map(r => r.fiscal_year))].sort();
  if (years.length < 2) return null; // Need at least 2 data points

  const latestFy = years.at(-1)!;
  const forecastYears = Array.from({ length: horizonYears }, (_, i) => latestFy + 1 + i);

  // Build series per metric
  const rows: AiRow[] = AI_METRICS.map(metric => {
    const stmtType = ["Net Worth", "Total Debt"].includes(metric) ? "balance_sheet" : "profit_loss";
    const series: number[] = [];
    for (const fy of years) {
      const row = histRows.find(r => r.statement_type === stmtType && r.fiscal_year === fy);
      const items = (row?.line_items as LineItem[] | null) ?? [];
      const val = resolveAlias(items, HIST_ALIASES[metric] ?? [metric]);
      series.push(val ?? 0);
    }
    const hw = holtwinters(series, horizonYears);
    return { label: metric, histSeries: series, forecast: hw.forecast, ciHigh: hw.ciHigh, ciLow: hw.ciLow, mape: hw.mape, ebitdaPct: null, patPct: null };
  });

  // Overall model confidence (worst of the key metrics)
  const { confidence } = holtwinters(
    rows.find(r => r.label === "Turnover")?.histSeries ?? [0],
    horizonYears,
  );

  // Add EBITDA% and PAT% relative to Turnover forecast
  const turnoverRow = rows.find(r => r.label === "Turnover");
  const ebitdaRow   = rows.find(r => r.label === "EBITDA");
  const patRow      = rows.find(r => r.label === "PAT");

  if (turnoverRow && ebitdaRow) {
    ebitdaRow.ebitdaPct = turnoverRow.forecast.map((t, i) =>
      t > 0 ? (ebitdaRow.forecast[i] / t) * 100 : 0
    );
  }
  if (turnoverRow && patRow) {
    patRow.patPct = turnoverRow.forecast.map((t, i) =>
      t > 0 ? (patRow.forecast[i] / t) * 100 : 0
    );
  }

  // Historical CAGR — only meaningful with 3+ years; with 2 pts it's just a single-period jump
  const histTurnover = rows.find(r => r.label === "Turnover")?.histSeries ?? [];
  const histFirst = histTurnover.find(v => v > 0) ?? null;
  const histLast  = histTurnover.at(-1) ?? null;
  const histCagr  = histFirst && histLast && histFirst > 0 && years.length >= 3
    ? ((Math.pow(histLast / histFirst, 1 / (years.length - 1)) - 1) * 100)
    : null;
  // For 2-year case, show simple 1Y growth separately so it doesn't masquerade as CAGR
  const hist1yGrowth = years.length === 2 && histFirst && histLast && histFirst > 0
    ? ((histLast / histFirst - 1) * 100)
    : null;

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Header */}
      <div style={{
        margin: "14px 0 0",
        padding: "8px 16px",
        background: DS.navy,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E", flexShrink: 0, boxShadow: "0 0 4px #22C55E" }} />
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#FFFFFF", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            AI-Estimated Financial Projections
          </span>
          <span style={{ fontSize: 9, color: "#888", marginLeft: 4 }}>₹ Lakhs</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {histCagr !== null && (
            <span style={{ fontSize: 9, color: "#AAAAAA" }}>
              Hist. Rev. CAGR ({years.length - 1}Y): <strong style={{ color: histCagr >= 0 ? "#4ADE80" : "#F87171" }}>{histCagr >= 0 ? "+" : ""}{histCagr.toFixed(1)}%</strong>
            </span>
          )}
          {hist1yGrowth !== null && (
            <span style={{ fontSize: 9, color: "#AAAAAA" }}>
              FY{years[0]}→FY{years[1]} rev. growth: <strong style={{ color: hist1yGrowth >= 0 ? "#4ADE80" : "#F87171" }}>{hist1yGrowth >= 0 ? "+" : ""}{hist1yGrowth.toFixed(1)}%</strong>
              <span style={{ color: "#666", fontWeight: 400 }}> (1Y only — not a CAGR)</span>
            </span>
          )}
          {rows.find(r => r.label === "Turnover")?.mape != null && (
            <span style={{ fontSize: 9, color: "#AAAAAA" }}>
              MAPE: <strong style={{ color: (rows.find(r => r.label === "Turnover")!.mape! < 10) ? "#4ADE80" : (rows.find(r => r.label === "Turnover")!.mape! < 25) ? "#FCD34D" : "#F87171" }}>
                {rows.find(r => r.label === "Turnover")!.mape!.toFixed(1)}%
              </strong>
            </span>
          )}
          <span style={{
            fontSize: 8.5, fontWeight: 700, padding: "2px 7px", borderRadius: 3,
            background: confidence === "high" ? "#14532D" : confidence === "medium" ? "#713F12" : confidence === "low" ? "#7F1D1D" : "#1C1C1C",
            color: confidence === "high" ? "#4ADE80" : confidence === "medium" ? "#FCD34D" : "#F87171",
            border: `1px solid ${confidence === "high" ? "#4ADE80" : confidence === "medium" ? "#F59E0B" : "#EF4444"}`,
          }}>
            {confidence === "high" ? "HIGH CONF" : confidence === "medium" ? "MED CONF" : confidence === "low" ? "LOW CONF" : "⚠ VERY LOW CONF"}
          </span>
          <span style={{ fontSize: 9, color: "#888" }}>Damped HW · {years.length}Y data</span>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#1E2E42", borderBottom: "1px solid #2A3A50" }}>
            <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#CCCCCC", width: "22%" }}>Metric</th>
            {/* Historical years */}
            {years.map(y => (
              <th key={`h-${y}`} style={{ padding: "7px 8px", textAlign: "right", fontSize: 9, fontWeight: 600, color: "#888888" }}>
                FY{y}<span style={{ display: "block", fontSize: 8, color: "#666", fontWeight: 400 }}>Actual</span>
              </th>
            ))}
            {/* Forecast years */}
            {forecastYears.map(y => (
              <th key={`f-${y}`} style={{ padding: "7px 8px", textAlign: "right", fontSize: 9, fontWeight: 700, color: DS.gold }}>
                FY{y} (E)<span style={{ display: "block", fontSize: 8, color: "#A08020", fontWeight: 400 }}>Est.</span>
              </th>
            ))}
            <th style={{ padding: "7px 8px", textAlign: "right", fontSize: 9, fontWeight: 600, color: "#888888", whiteSpace: "nowrap" }}>CAGR</th>
            <th style={{ padding: "7px 8px", textAlign: "right", fontSize: 9, fontWeight: 400, color: "#666", whiteSpace: "nowrap" }}>+90% CI</th>
            <th style={{ padding: "7px 8px", textAlign: "right", fontSize: 9, fontWeight: 400, color: "#666", whiteSpace: "nowrap" }}>−90% CI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const fcFirst = row.forecast[0] ?? null;
            const fcLast  = row.forecast.at(-1) ?? null;
            const cagr = fcFirst !== null && fcLast !== null
              ? cagrFmt(fcFirst, fcLast, horizonYears - 1)
              : "—";
            const isNeg = (fcLast ?? 0) < 0;
            const rowBg = i % 2 === 0 ? "#FFFFFF" : DS.altRow;

            return (
              <React.Fragment key={row.label}>
                <tr style={{ background: rowBg }}>
                  <td style={{ padding: "7px 12px", fontSize: 11, fontWeight: 600, color: DS.body, borderBottom: "1px solid #EBEBEB" }}>
                    {row.label}
                  </td>
                  {/* Historical */}
                  {row.histSeries.map((v, hi) => (
                    <td key={`hv-${hi}`} style={{ padding: "7px 8px", textAlign: "right", fontSize: 10.5, color: "#888888", borderBottom: "1px solid #EBEBEB", fontVariantNumeric: "tabular-nums" }}>
                      {v !== 0 ? icFmt(v) : "—"}
                    </td>
                  ))}
                  {/* Forecast */}
                  {row.forecast.map((v, fi) => (
                    <td key={`fv-${fi}`} style={{ padding: "7px 8px", textAlign: "right", fontSize: 11, color: v < 0 ? DS.red : DS.body, borderBottom: "1px solid #EBEBEB", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
                      {icFmt(v)}
                      {row.ebitdaPct && row.ebitdaPct[fi] != null && (
                        <span style={{ display: "block", fontSize: 8.5, color: DS.muted }}>{row.ebitdaPct[fi].toFixed(1)}%</span>
                      )}
                      {row.patPct && row.patPct[fi] != null && (
                        <span style={{ display: "block", fontSize: 8.5, color: DS.muted }}>{row.patPct[fi].toFixed(1)}%</span>
                      )}
                    </td>
                  ))}
                  {/* CAGR */}
                  <td style={{ padding: "7px 8px", textAlign: "right", fontSize: 10, fontWeight: 700, borderBottom: "1px solid #EBEBEB", color: isNeg ? DS.red : DS.green, fontVariantNumeric: "tabular-nums" }}>
                    {cagr}
                  </td>
                  {/* CI high — only first column */}
                  <td style={{ padding: "7px 8px", textAlign: "right", fontSize: 9.5, color: "#999", borderBottom: "1px solid #EBEBEB", fontVariantNumeric: "tabular-nums" }}>
                    {row.ciHigh[0] != null ? icFmt(row.ciHigh[0]) : "—"}
                  </td>
                  <td style={{ padding: "7px 8px", textAlign: "right", fontSize: 9.5, color: "#999", borderBottom: "1px solid #EBEBEB", fontVariantNumeric: "tabular-nums" }}>
                    {row.ciLow[0] != null ? icFmt(row.ciLow[0]) : "—"}
                  </td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      {/* Footer disclaimer */}
      <div style={{ margin: "4px 0 0", padding: "5px 12px", background: "#F8F7F2", borderTop: "1px solid #E8E8E4" }}>
        <span style={{ fontSize: 8.5, color: DS.muted, fontStyle: "italic" }}>
          ▸ AI estimate only · Damped-Trend Holt-Winters (φ=0.88) on {years.length}Y actuals ·
          {years.length < 3 ? " Low-data: blended 50% toward 20% sustainable growth rate ·" : ""}
          {" "}90% CI widens with horizon · MAPE measures in-sample fit accuracy ·
          Upload management projections to enable sanity check.
        </span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function ProjectionsCard({ extracted, provisional, comment, note, generating, onGenerate, pageNum }: ProjectionsCardProps) {
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

  const provPeriods = (provisional ?? []).sort((a, b) => a.fiscal_year - b.fiscal_year);

  const hasProjections = projYears.length > 0;
  const hasProvisional = provPeriods.length > 0;
  const hasComment = !!(comment && comment.trim());

  // Check if we have enough historical data for AI estimates
  const histPlRows = extracted.filter(r => r.statement_type === "profit_loss" || r.statement_type === "balance_sheet");
  const histYears = [...new Set(histPlRows.map(r => r.fiscal_year))];
  const canEstimate = !hasProjections && histYears.length >= 2;

  return (
    <SlideShell roman="VI" title="Projections & Estimates" pageNum={pageNum}>
      <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>

        {/* ── Uploaded Projected Financials ────────────────────────────────── */}
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

        {/* ── AI Estimates (when no projections uploaded) ───────────────────── */}
        {canEstimate && (
          <AiEstimatesBlock extracted={extracted} horizonYears={3} />
        )}

        {/* ── No data at all ────────────────────────────────────────────────── */}
        {!hasProjections && !canEstimate && !hasProvisional && !hasComment && (
          <div style={{ padding: "40px 24px", textAlign: "center", fontSize: 11, color: DS.muted, fontStyle: "italic" }}>
            No projection or provisional data available. Upload projections or fill in the Provisional tab to populate this section.
          </div>
        )}

        {/* ── Provisional P&L ──────────────────────────────────────────────── */}
        {hasProvisional && (
          <ProvTable
            sectionTitle="Provisional P&L (₹ Lakhs)"
            periods={provPeriods}
            labels={PL_LABELS}
            getVal={(p, label, unit) => getItemVal(p.pl, label, unit)}
          />
        )}

        {/* ── Provisional Balance Sheet ─────────────────────────────────────── */}
        {hasProvisional && (
          <ProvTable
            sectionTitle="Provisional Balance Sheet (₹ Lakhs)"
            periods={provPeriods}
            labels={BS_LABELS}
            getVal={(p, label, unit) => getItemVal(p.bs, label, unit)}
          />
        )}

        {/* ── Provisional Cash Flow ─────────────────────────────────────────── */}
        {hasProvisional && (
          <ProvTable
            sectionTitle="Provisional Cash Flow (₹ Lakhs)"
            periods={provPeriods}
            labels={CF_LABELS}
            getVal={(p, label, unit) => getItemVal(p.cf ?? [], label, unit)}
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

        {/* ── AI Projection Analysis — separate section ─────────────────────── */}
        <div style={{ margin: "16px 0 0", borderTop: `2px solid ${DS.gold}` }}>
          {/* Section header with generate button */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 20px 6px", background: DS.navy }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#FFFFFF", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              ✦ AI Projection Analysis
            </span>
            {onGenerate && (
              <button
                onClick={onGenerate}
                disabled={generating}
                style={{
                  fontSize: 9, fontWeight: 600, color: DS.navy, background: DS.gold,
                  border: "none", borderRadius: 3, padding: "3px 10px", cursor: generating ? "not-allowed" : "pointer",
                  opacity: generating ? 0.7 : 1, letterSpacing: "0.05em",
                }}
              >
                {generating ? "Generating…" : note ? "↺ Regenerate" : "✦ Generate"}
              </button>
            )}
          </div>

          {/* Content */}
          {generating && !note && (
            <div style={{ padding: "16px 20px", textAlign: "center", fontSize: 11, color: DS.muted, fontStyle: "italic" }}>
              Generating AI projection analysis…
            </div>
          )}

          {note ? (
            <div style={{ padding: "12px 20px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                <span style={{ fontSize: 9, color: DS.muted, fontStyle: "italic" }}>
                  Generated {new Date(note.generated_at).toLocaleDateString()}
                </span>
              </div>
              {note.headline && (
                <div style={{ fontSize: 11, fontWeight: 600, color: DS.navy, marginBottom: 8, lineHeight: 1.5, padding: "6px 10px", background: "#EEF2FF", borderRadius: 3 }}>
                  {note.headline}
                </div>
              )}
              {note.bullets.length > 0 && (
                <ul style={{ margin: "0 0 8px", paddingLeft: 16 }}>
                  {note.bullets.map((b, i) => (
                    <li key={i} style={{ fontSize: 11, color: DS.body, lineHeight: 1.65, marginBottom: 3 }}>{b}</li>
                  ))}
                </ul>
              )}
              {note.flags.length > 0 && (
                <div>
                  {note.flags.map((f, i) => (
                    <div key={i} style={{ fontSize: 10, color: "#B45309", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 3, padding: "4px 10px", marginBottom: 3 }}>
                      ⚠ {f}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : !generating && (
            <div style={{ padding: "14px 20px", fontSize: 11, color: DS.muted, fontStyle: "italic" }}>
              Click Generate to get an AI-driven projection analysis combining historical data, estimates, and provisional financials.
            </div>
          )}
        </div>

      </div>
    </SlideShell>
  );
}
