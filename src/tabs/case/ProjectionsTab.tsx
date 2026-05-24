/**
 * ProjectionsTab — AI-powered financial projection analysis.
 *
 * When no projection document is uploaded, builds a statistical model from
 * historical P&L / BS using OLS regression (≥3 yrs) or Holt-Winters double
 * exponential smoothing (2 yrs) with 90 % prediction intervals.
 *
 * When projections are uploaded, runs a full sanity check: metric-by-metric
 * variance, CAGR comparison, risk flags, and an overall credibility verdict.
 */

import { useMemo, useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Panel } from "@/components/terminal/Panel";
import {
  ComposedChart, Bar, Line, LineChart, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import type { ExtractedRow, CaseRow, LineItem } from "@/features/case/types";
import { unitAbbr, fmtUnit } from "@/features/case/utils";

// ─── Recharts tooltip style ───────────────────────────────────────────────────
const TT: React.CSSProperties = {
  backgroundColor: "#0d1117", border: "1px solid #1f2937",
  color: "#e2e8f0", fontSize: "11px", borderRadius: "2px",
};

// ═══════════════════════════════════════════════════════════════════════════════
// ALGORITHM LAYER — pure functions, no side effects
// ═══════════════════════════════════════════════════════════════════════════════

interface OLSResult {
  slope: number;
  intercept: number;
  r2: number;
  rmse: number;
  predict: (x: number) => number;
}

/** Ordinary Least Squares linear regression (y = slope·x + intercept). */
function ols(xs: number[], ys: number[]): OLSResult | null {
  const n = xs.length;
  if (n < 2) return null;
  const xm = xs.reduce((a, b) => a + b) / n;
  const ym = ys.reduce((a, b) => a + b) / n;
  let ssxy = 0, ssxx = 0;
  for (let i = 0; i < n; i++) { ssxy += (xs[i] - xm) * (ys[i] - ym); ssxx += (xs[i] - xm) ** 2; }
  if (ssxx === 0) return null;
  const slope = ssxy / ssxx;
  const intercept = ym - slope * xm;
  const pred = (x: number) => slope * x + intercept;
  const preds = xs.map(pred);
  const ssTot = ys.reduce((a, y) => a + (y - ym) ** 2, 0);
  const ssRes = ys.reduce((a, y, i) => a + (y - preds[i]) ** 2, 0);
  const r2   = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 1;
  const rmse = Math.sqrt(ssRes / n);
  return { slope, intercept, r2, rmse, predict: pred };
}

/**
 * Holt's double exponential smoothing (level + linear trend).
 * Returns h-step-ahead point forecasts and the smoothed state.
 */
function holts(
  data: number[],
  alpha = 0.5,
  beta  = 0.3,
  h     = 3,
): { forecasts: number[]; level: number; trend: number } {
  if (data.length === 0) return { forecasts: [], level: 0, trend: 0 };
  if (data.length === 1) return { forecasts: Array(h).fill(data[0]), level: data[0], trend: 0 };
  let level = data[0];
  let trend = data[1] - data[0];
  for (let i = 1; i < data.length; i++) {
    const pL = level;
    level = alpha * data[i] + (1 - alpha) * (level + trend);
    trend = beta  * (level - pL) + (1 - beta) * trend;
  }
  return { forecasts: Array.from({ length: h }, (_, i) => level + (i + 1) * trend), level, trend };
}

/** Population standard deviation. */
function stdDev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = vals.reduce((a, b) => a + b) / vals.length;
  return Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / vals.length);
}

function cagr(v0: number | null, vn: number | null, n: number): number | null {
  if (!v0 || !vn || n <= 0 || v0 <= 0) return null;
  return (Math.pow(vn / v0, 1 / n) - 1) * 100;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODEL BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

type ModelMethod = "ols_regression" | "holt_winters" | "cagr" | "default";
type Confidence  = "HIGH" | "MEDIUM" | "LOW";
type Trend       = "improving" | "stable" | "declining";

interface ProjectionPoint {
  fy: number;
  turnover:  number | null;
  ebitda:    number | null;
  pat:       number | null;
  networth:  number | null;
  totalDebt: number | null;
  upper:     number | null;  // 90 % prediction interval upper
  lower:     number | null;  // 90 % prediction interval lower
}

interface ModelOutput {
  points: ProjectionPoint[];
  method: ModelMethod;
  r2: number | null;
  rmse: number | null;
  confidence: Confidence;
  avgGrowthPct: number;
  avgEbitdaMarginPct: number | null;
  avgPatMarginPct:    number | null;
  ebitdaTrend: Trend | null;
  patTrend:    Trend | null;
  baseFY: number;
  histYears: number;
}

function getv(items: LineItem[], label: string): number | null {
  const it = items.find(i => i.label === label);
  if (!it) return null;
  return it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
}

function buildModel(
  histPL: ExtractedRow[],
  histBS: ExtractedRow[],
  nForward: number,
): ModelOutput | null {
  if (histPL.length === 0 || nForward < 1) return null;

  const sorted = [...histPL].sort((a, b) => a.fiscal_year - b.fiscal_year);
  const hist = sorted.map(row => {
    const pl = (row.line_items ?? []) as unknown as LineItem[];
    const bs = ((histBS.find(b => b.fiscal_year === row.fiscal_year)?.line_items ?? []) as unknown as LineItem[]);
    return {
      fy:        row.fiscal_year,
      turnover:  getv(pl, "Turnover"),
      ebitda:    getv(pl, "EBITDA"),
      pat:       getv(pl, "PAT"),
      networth:  getv(bs, "Net Worth"),
      totalDebt: getv(bs, "Total Debt"),
    };
  });

  const validRev = hist.filter(h => h.turnover != null && h.turnover > 0);
  const last = hist[hist.length - 1];
  const lastFY = last.fy;

  // ── Revenue model selection ──────────────────────────────────────────────
  let method: ModelMethod = "default";
  let r2: number | null = null;
  let rmse: number | null = null;
  let confidence: Confidence = "LOW";
  let revForecasts: (number | null)[] = Array(nForward).fill(null);
  let upper: (number | null)[] = Array(nForward).fill(null);
  let lower: (number | null)[] = Array(nForward).fill(null);
  let avgGrowth = 0.10;

  if (validRev.length >= 3) {
    // OLS on (0-based year index → turnover)
    const xs = validRev.map((_, i) => i);
    const ys = validRev.map(h => h.turnover as number);
    const reg = ols(xs, ys);

    if (reg && reg.r2 >= 0.70) {
      method = "ols_regression";
      r2 = reg.r2;
      rmse = reg.rmse;
      confidence = reg.r2 >= 0.90 ? "HIGH" : "MEDIUM";
      const base = validRev.length - 1;
      revForecasts = Array.from({ length: nForward }, (_, h) => Math.max(0, reg.predict(base + h + 1)));
      // 90 % PI: ±1.645 × RMSE
      const band = reg.rmse * 1.645;
      upper = revForecasts.map(v => v != null ? v + band : null);
      lower = revForecasts.map(v => v != null ? Math.max(0, v - band) : null);
      const pBase = reg.predict(base), pNext = reg.predict(base + 1);
      avgGrowth = pBase > 0 ? (pNext - pBase) / pBase : 0.10;
    } else {
      // OLS fit is weak — use Holt-Winters
      const hv = holts(ys, 0.5, 0.3, nForward);
      method = "holt_winters";
      r2 = reg?.r2 ?? null;
      confidence = "MEDIUM";
      revForecasts = hv.forecasts.map(v => Math.max(0, v));
      const growthRates: number[] = [];
      for (let i = 1; i < validRev.length; i++) {
        const p = validRev[i - 1].turnover!, c = validRev[i].turnover!;
        if (p > 0) growthRates.push((c - p) / p);
      }
      const gStd = stdDev(growthRates) || 0.10;
      upper = revForecasts.map((v, h) => v != null ? v * (1 + gStd * Math.sqrt(h + 1)) : null);
      lower = revForecasts.map((v, h) => v != null ? Math.max(0, v * (1 - gStd * Math.sqrt(h + 1))) : null);
      avgGrowth = growthRates.length ? growthRates.reduce((a, b) => a + b) / growthRates.length : 0.10;
    }
  } else if (validRev.length === 2) {
    const ys = validRev.map(h => h.turnover as number);
    const hv = holts(ys, 0.6, 0.4, nForward);
    method = "holt_winters";
    confidence = "MEDIUM";
    revForecasts = hv.forecasts.map(v => Math.max(0, v));
    avgGrowth = ys[0] > 0 ? (ys[1] - ys[0]) / ys[0] : 0.10;
    const band = Math.abs(avgGrowth) * 0.60;
    upper = revForecasts.map((v, h) => v != null ? v * (1 + band * Math.sqrt(h + 1)) : null);
    lower = revForecasts.map((v, h) => v != null ? Math.max(0, v * (1 - band * Math.sqrt(h + 1))) : null);
  } else if (validRev.length === 1) {
    method = "cagr";
    confidence = "LOW";
    let prev = validRev[0].turnover as number;
    revForecasts = Array.from({ length: nForward }, () => { prev *= 1.10; return prev; });
    upper = revForecasts.map(v => v * 1.30);
    lower = revForecasts.map(v => v * 0.70);
    avgGrowth = 0.10;
  }

  // ── Margin forecasting (Holt-Winters on margin series) ──────────────────
  const eMs = hist.map(h => h.turnover && h.ebitda != null ? h.ebitda / h.turnover : null).filter((v): v is number => v != null);
  const pMs = hist.map(h => h.turnover && h.pat    != null ? h.pat    / h.turnover : null).filter((v): v is number => v != null);

  let avgEM: number | null = eMs.length ? eMs.reduce((a, b) => a + b) / eMs.length : null;
  let avgPM: number | null = pMs.length ? pMs.reduce((a, b) => a + b) / pMs.length : null;
  let ebitdaTrend: Trend | null = null;
  let patTrend:    Trend | null = null;

  if (eMs.length >= 2) {
    const hv = holts(eMs, 0.5, 0.3, 1);
    avgEM = hv.level;
    ebitdaTrend = Math.abs(hv.trend) < 0.005 ? "stable" : hv.trend > 0 ? "improving" : "declining";
  }
  if (pMs.length >= 2) {
    const hv = holts(pMs, 0.5, 0.3, 1);
    avgPM = hv.level;
    patTrend = Math.abs(hv.trend) < 0.003 ? "stable" : hv.trend > 0 ? "improving" : "declining";
  }

  // ── Build projection points ──────────────────────────────────────────────
  let prevNW = last.networth;
  const points: ProjectionPoint[] = revForecasts.map((rev, i) => {
    const fy      = lastFY + i + 1;
    const ebitda  = rev != null && avgEM != null ? rev * avgEM : null;
    const pat     = rev != null && avgPM != null ? rev * avgPM : null;
    const networth = prevNW != null && pat != null ? prevNW + pat : prevNW;
    prevNW = networth ?? prevNW;
    return { fy, turnover: rev, ebitda, pat, networth, totalDebt: last.totalDebt, upper: upper[i], lower: lower[i] };
  });

  return {
    points, method, r2, rmse, confidence,
    avgGrowthPct: avgGrowth * 100,
    avgEbitdaMarginPct: avgEM != null ? avgEM * 100 : null,
    avgPatMarginPct:    avgPM != null ? avgPM * 100 : null,
    ebitdaTrend, patTrend, baseFY: lastFY, histYears: hist.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RISK FLAG ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

type Severity = "HIGH" | "MEDIUM" | "LOW";
interface RiskFlag { id: string; severity: Severity; title: string; detail: string; }

function assessRisks(
  projData:  Array<{ fy: number; turnover: number | null; ebitda: number | null; pat: number | null; networth: number | null; totalDebt: number | null }>,
  model:     ModelOutput,
  abbr:      string,
): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const n = projData.length;
  if (n === 0 || model.points.length === 0) return flags;

  const upRev = cagr(projData[0].turnover, projData[n - 1].turnover, n - 1);
  const mdRev = cagr(model.points[0].turnover, model.points[model.points.length - 1].turnover, model.points.length - 1);

  // 1. Revenue CAGR vs model
  if (upRev != null && mdRev != null) {
    const excess = upRev - mdRev;
    if (excess > 25)
      flags.push({ id: "rev_very_aggressive", severity: "HIGH",
        title: "Revenue CAGR far exceeds model estimate",
        detail: `Uploaded CAGR ${upRev.toFixed(1)}% vs model ${mdRev.toFixed(1)}% (+${excess.toFixed(1)}pp). Requires strong business justification.` });
    else if (excess > 10)
      flags.push({ id: "rev_aggressive", severity: "MEDIUM",
        title: "Revenue growth above trend",
        detail: `Uploaded CAGR ${upRev.toFixed(1)}% vs model ${mdRev.toFixed(1)}% (+${excess.toFixed(1)}pp). Verify assumptions.` });
  }

  // 2. First-year jump (Y1 uploaded vs last historical actual)
  const lastHistRev = model.points.length > 0 ? model.points[0].turnover : null;  // proxy: model Y1 as near-historical
  const y1Up = projData[0].turnover;
  if (y1Up != null && model.points[0].upper != null && y1Up > model.points[0].upper)
    flags.push({ id: "y1_above_upper_ci", severity: "HIGH",
      title: "Y1 revenue above 90 % prediction interval",
      detail: `FY${projData[0].fy} uploaded ${y1Up.toLocaleString("en-IN")}${abbr} exceeds model upper bound ${model.points[0].upper.toLocaleString("en-IN")}${abbr}.` });

  // 3. EBITDA margin expansion
  const upEM = projData.map(d => d.turnover && d.ebitda != null ? d.ebitda / d.turnover : null).filter((v): v is number => v != null);
  const avgUpEM = upEM.length ? upEM.reduce((a, b) => a + b) / upEM.length : null;
  const mdEM = model.avgEbitdaMarginPct != null ? model.avgEbitdaMarginPct / 100 : null;
  if (avgUpEM != null && mdEM != null) {
    const delta = (avgUpEM - mdEM) * 100;
    if (delta > 5)
      flags.push({ id: "ebitda_margin_expansion", severity: delta > 10 ? "HIGH" : "MEDIUM",
        title: `EBITDA margin expansion of +${delta.toFixed(1)}pp assumed`,
        detail: `Uploaded avg ${(avgUpEM * 100).toFixed(1)}% vs historical trend ${(mdEM * 100).toFixed(1)}%. State cost-reduction or pricing levers.` });
  }

  // 4. PAT growing faster than EBITDA (falling interest/tax assumption)
  const upPAT_CAGR  = cagr(projData[0].pat,   projData[n-1].pat,   n - 1);
  const upEBIT_CAGR = cagr(projData[0].ebitda, projData[n-1].ebitda, n - 1);
  if (upPAT_CAGR != null && upEBIT_CAGR != null && upPAT_CAGR > upEBIT_CAGR + 8)
    flags.push({ id: "pat_faster_than_ebitda", severity: "MEDIUM",
      title: "PAT growing faster than EBITDA",
      detail: `PAT CAGR ${upPAT_CAGR.toFixed(1)}% vs EBITDA CAGR ${upEBIT_CAGR.toFixed(1)}%. Implies falling interest expense or effective tax rate — verify.` });

  // 5. Sharp debt reduction without justification
  const d0 = projData[0].totalDebt, dn = projData[n - 1].totalDebt;
  if (d0 != null && dn != null && d0 > 0 && (d0 - dn) / d0 > 0.40)
    flags.push({ id: "debt_reduction", severity: "MEDIUM",
      title: `Debt projected to fall ${(((d0 - dn) / d0) * 100).toFixed(0)}% over projection period`,
      detail: `From ${d0.toLocaleString("en-IN")}${abbr} to ${dn.toLocaleString("en-IN")}${abbr}. Confirm repayment source and schedule.` });

  // 6. Low model confidence warning
  if (model.confidence === "LOW")
    flags.push({ id: "low_model_confidence", severity: "LOW",
      title: "AI estimate based on limited history (< 2 years)",
      detail: "Model confidence is low. Uploaded projections cannot be reliably benchmarked against trend." });

  return flags.sort((a, b) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[a.severity] - { HIGH: 0, MEDIUM: 1, LOW: 2 }[b.severity]));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const fmt = (n: number | null | undefined, dec = 2) =>
  n == null || !Number.isFinite(n as number) ? "—"
  : (n as number).toLocaleString("en-IN", { maximumFractionDigits: dec, minimumFractionDigits: dec });

const pct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n as number) ? "—" : (n as number).toFixed(1) + "%";

function varInfo(uploaded: number | null, estimated: number | null) {
  if (uploaded == null || estimated == null || estimated === 0)
    return { pct: null as number | null, label: "—", cls: "text-muted-foreground/40", verdict: "" };
  const p   = ((uploaded - estimated) / Math.abs(estimated)) * 100;
  const abs = Math.abs(p);
  const sgn = p > 0 ? "+" : "";
  if (abs < 15) return { pct: p, label: `${sgn}${p.toFixed(1)}%`, cls: "text-success",     verdict: "IN LINE" };
  if (abs < 35) return { pct: p, label: `${sgn}${p.toFixed(1)}%`, cls: "text-warning",     verdict: p > 0 ? "OPTIMISTIC"      : "CONSERVATIVE" };
  return         { pct: p, label: `${sgn}${p.toFixed(1)}%`, cls: "text-destructive", verdict: p > 0 ? "VERY OPTIMISTIC" : "VERY CONSERVATIVE" };
}

const METHOD_LABEL: Record<ModelMethod, string> = {
  ols_regression: "OLS Regression",
  holt_winters:   "Holt-Winters Smoothing",
  cagr:           "CAGR (1yr)",
  default:        "Default (no data)",
};

const CONF_CLS: Record<Confidence, string> = {
  HIGH:   "text-success border-success/50 bg-success/10",
  MEDIUM: "text-warning border-warning/50 bg-warning/10",
  LOW:    "text-destructive border-destructive/50 bg-destructive/10",
};
const SEV_CLS: Record<Severity, string> = {
  HIGH:   "text-destructive",
  MEDIUM: "text-warning",
  LOW:    "text-muted-foreground",
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

// ── Direct Excel import parser ────────────────────────────────────────────────
const PROJ_LABEL_MAP: Array<[RegExp, string]> = [
  [/turn.*over|revenue|net\s*sales?/i,          "Projected Turnover"],
  [/\bebitda\b/i,                               "Projected EBITDA"],
  [/profit\s*after\s*tax|^pat$|\bnet\s*profit\b/i, "Projected PAT"],
  [/profit\s*before\s*tax|^pbt$/i,              "Projected Profit Before Tax"],
  [/\bebit\b/i,                                 "Projected EBIT"],
  [/gross\s*profit/i,                           "Projected Gross Profit"],
  [/net\s*worth|shareholders?\s*equity|equity\s*capital/i, "Projected Net Worth"],
  [/total\s*debt|borrowing/i,                   "Projected Total Debt"],
  [/depreciation/i,                             "Projected Depreciation"],
  [/interest|finance\s*cost/i,                  "Projected Interest Expense"],
  [/cogs|cost\s*of\s*goods/i,                   "Projected COGS"],
  [/total\s*assets?/i,                          "Projected Total Assets"],
  [/operating\s*exp/i,                          "Projected Operating Expenses"],
];

function mapProjLabel(raw: string): string {
  const s = raw.trim().replace(/^\s*projected\s*/i, "");
  for (const [re, mapped] of PROJ_LABEL_MAP) if (re.test(s)) return mapped;
  // Keep as-is but prefix with "Projected" if it doesn't already have it
  return /^projected/i.test(raw.trim()) ? raw.trim() : `Projected ${raw.trim()}`;
}

function parseIndianNum(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).replace(/,/g, "").trim();
  if (!s || s === "-" || s === "—") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

async function parseProjectionExcel(
  file: File,
): Promise<{ fiscal_year: number; line_items: LineItem[]; unit: string }[]> {
  const XLSX = await import("xlsx");
  const buf  = await file.arrayBuffer();
  const wb   = XLSX.read(buf, { type: "array", raw: false, cellText: true });

  // Try each sheet; use the first one that has year-column headers
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false }) as string[][];
    if (rows.length < 2) continue;

    // Detect unit from any cell in first 8 rows
    let unit = "Lakhs";
    for (const row of rows.slice(0, 8)) {
      const found = row.find(c => /amount\s*in\s*(rs|inr|lakh|crore|thousands?)/i.test(String(c)));
      if (found) {
        const s = String(found).toLowerCase();
        if (/crore/i.test(s)) unit = "Crores";
        else if (/thousand/i.test(s)) unit = "Thousands";
        break;
      }
    }

    // Find header row: first row where ≥1 column matches a year pattern
    let headerIdx = -1;
    const fyColumns: { col: number; fy: number }[] = [];

    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      const row = rows[i];
      const found: typeof fyColumns = [];
      for (let c = 1; c < row.length; c++) {
        const cell = String(row[c]).trim();
        // FY25, FY2025, FY25-26, FY2025-26, 2025, 2025-26
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

    // Collect line items per FY
    const fyItems: Record<number, LineItem[]> = {};
    for (const { fy } of fyColumns) fyItems[fy] = [];

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const rawLabel = String(row[0] ?? "").trim();
      if (!rawLabel || /^(total|sub.?total|---|\s*sr\.?\s*no\.?)$/i.test(rawLabel)) continue;

      const label = mapProjLabel(rawLabel);
      for (const { col, fy } of fyColumns) {
        const val = parseIndianNum(row[col]);
        if (val == null) continue;
        // deduplicate — if label already added, overwrite
        const arr = fyItems[fy];
        const idx = arr.findIndex(it => it.label === label);
        if (idx === -1) arr.push({ label, value: val, confidence: 90, reviewed: false });
        else arr[idx] = { ...arr[idx], value: val };
      }
    }

    const result = Object.entries(fyItems)
      .filter(([, items]) => items.length > 0)
      .map(([fyStr, items]) => ({ fiscal_year: Number(fyStr), line_items: items, unit }));

    if (result.length > 0) return result;
  }

  throw new Error("No fiscal year columns found in the Excel. Make sure column headers include a year (e.g. FY26, FY2026, 2026).");
}

export function ProjectionsTab({
  extracted,
  cc,
  busy,
  progress,
  progressLabel,
  onGenerateNote,
  projComment = "",
  onSaveComment,
  onUpload,
  onDirectImport,
}: {
  extracted: ExtractedRow[];
  cc: CaseRow;
  busy: boolean;
  progress: number;
  progressLabel: string;
  onGenerateNote: () => void;
  projComment?: string;
  onSaveComment?: (text: string) => Promise<void>;
  onUpload?: (file: File, fiscalYear: number | null) => Promise<void>;
  onDirectImport?: (data: { fiscal_year: number; line_items: LineItem[]; unit: string }[]) => Promise<void>;
}) {
  const projRows = extracted.filter(r => r.statement_type === "projections");
  const histPL   = extracted.filter(r => r.statement_type === "profit_loss");
  const histBS   = extracted.filter(r => r.statement_type === "balance_sheet");

  const unit       = projRows[0]?.unit ?? histPL[0]?.unit ?? null;
  const abbr       = unitAbbr(unit);
  const unitTicker = fmtUnit(unit);

  const liVal = (items: LineItem[], label: string): number | null => {
    const it = items.find(i => i.label === label);
    if (!it) return null;
    return it.override_value !== undefined && it.override_value !== null ? it.override_value : it.value;
  };

  const uploadedYears = useMemo(() => [...new Set(projRows.map(r => r.fiscal_year))].sort(), [projRows]);
  const nForward      = uploadedYears.length > 0 ? uploadedYears.length : 3;

  const model = useMemo(() => buildModel(histPL, histBS, nForward), [histPL, histBS, nForward]);

  const [comment, setComment]       = useState(projComment);
  const [saving,  setSaving]        = useState(false);
  const [saved,   setSaved]         = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [directBusy, setDirectBusy] = useState(false);
  const importFileRef      = useRef<HTMLInputElement>(null);
  const directImportFileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setComment(projComment); }, [projComment]);

  const handleSave = async () => {
    if (!onSaveComment) return;
    setSaving(true);
    await onSaveComment(comment);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDirectImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onDirectImport) return;
    setDirectBusy(true);
    try {
      const data = await parseProjectionExcel(file);
      await onDirectImport(data);
      toast.success(`Imported projections for ${data.length} year${data.length !== 1 ? "s" : ""} — no AI used`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setDirectBusy(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onUpload) return;
    setImportBusy(true);
    try {
      await onUpload(file, null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setImportBusy(false);
    }
  };

  const importPanel = (onUpload || onDirectImport) ? (
    <Panel title="IMPORT PROJECTION DOCUMENT" ticker="PDF · EXCEL · IMAGE">
      <input ref={importFileRef} type="file" className="hidden"
        accept=".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp" onChange={handleImportFile} />
      <input ref={directImportFileRef} type="file" className="hidden"
        accept=".xlsx,.xls,.csv" onChange={handleDirectImportFile} />
      <button onClick={async () => {
        const XLSX = await import("xlsx");
        const wb = XLSX.utils.book_new();
        const fys = ["FY2025", "FY2026", "FY2027"];
        const labels = ["Projected Turnover","Projected EBITDA","Projected PAT","Projected Net Worth","Projected Total Debt","Projected Gross Profit","Projected EBIT","Projected Depreciation","Projected Interest Expense","Projected Operating Expenses","Projected Total Assets"];
        const rows = [["Particulars", ...fys], ["// Same unit as historical data. Import via DIRECT EXCEL IMPORT above."], ...labels.map(l => [l, "", "", ""])];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Projections");
        XLSX.writeFile(wb, "projections_template.xlsx");
      }} className="text-[10px] tracking-widest border border-accent/40 text-accent/80 px-3 py-1.5 hover:text-accent hover:border-accent/60 disabled:opacity-40">
        ⬇ TEMPLATE
      </button>

      <div className="space-y-4">
        {/* ── Direct Excel import (instant, no AI) ── */}
        {onDirectImport && (
          <div className="border border-accent/30 bg-accent/5 p-3 space-y-2">
            <div className="text-[9px] text-accent tracking-widest font-bold">DIRECT EXCEL IMPORT · INSTANT · NO AI</div>
            <div className="text-[9px] text-muted-foreground/70 leading-relaxed">
              Import a structured Excel file directly — no AI, no token cost, instant.
              First column = line item labels. Remaining columns = fiscal years (e.g. FY26, FY2026, 2026).
              Labels are auto-mapped to standard projection items.
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => directImportFileRef.current?.click()}
                disabled={directBusy || busy}
                className="bg-accent text-accent-foreground px-4 py-1.5 text-[10px] tracking-widest font-bold disabled:opacity-50"
              >
                {directBusy ? "IMPORTING…" : "[ ⬆ IMPORT EXCEL DIRECTLY ]"}
              </button>
              {directBusy && (
                <span className="text-[9px] text-accent tracking-widest animate-pulse">▸ Parsing…</span>
              )}
            </div>
          </div>
        )}

        {/* ── AI extraction (PDF / image / Excel via AI) ── */}
        {onUpload && (
          <div className="space-y-2">
            <div className="text-[9px] text-muted-foreground/60 tracking-widest font-bold">AI EXTRACTION · PDF / IMAGE / EXCEL</div>
            <div className="text-[9px] text-muted-foreground/70 leading-relaxed">
              Use AI to extract from PDF, image, or unstructured Excel. AI detects fiscal years and maps all projection line items automatically.
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => importFileRef.current?.click()}
                disabled={importBusy || busy}
                className="bg-primary text-primary-foreground px-4 py-1.5 text-[10px] tracking-widest font-bold disabled:opacity-50"
              >
                {importBusy ? "UPLOADING…" : "[ CHOOSE FILE → ]"}
              </button>
              {importBusy && (
                <span className="text-[9px] text-primary tracking-widest animate-pulse">▸ Extracting with AI…</span>
              )}
              {busy && !importBusy && (
                <span className="text-[9px] text-muted-foreground/50">▸ Another operation in progress…</span>
              )}
            </div>
          </div>
        )}
      </div>
    </Panel>
  ) : null;

  const commentPanel = (
    <Panel title="ANALYST COMMENTARY" ticker="PROJECTIONS NOTE">
      <div className="space-y-2">
        <textarea
          value={comment}
          onChange={e => { setComment(e.target.value); setSaved(false); }}
          rows={4}
          placeholder="Add your observations on the projections — assumptions, risks, management guidance, comparables..."
          className="w-full bg-input border border-border text-foreground text-xs p-2 resize-y placeholder:text-muted-foreground/40 font-mono leading-relaxed focus:outline-none focus:border-primary"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !onSaveComment}
            className="bg-primary text-primary-foreground px-4 py-1.5 text-[10px] tracking-widest font-bold disabled:opacity-50"
          >
            {saving ? "SAVING..." : saved ? "✓ SAVED" : "[SAVE COMMENT →]"}
          </button>
          {!onSaveComment && (
            <span className="text-[9px] text-muted-foreground tracking-wider">Save not wired — contact dev</span>
          )}
        </div>
      </div>
    </Panel>
  );

  // ── No data at all ────────────────────────────────────────────────────────
  if (projRows.length === 0 && !model) {
    return (
      <div className="space-y-3">
        {importPanel}
        <Panel title="NO PROJECTION DATA" ticker="UPLOAD REQUIRED">
          <div className="text-muted-foreground text-xs leading-relaxed space-y-1">
            <p>No projection document uploaded and no historical P&amp;L data to model from.</p>
            <p>Upload financial statements in the <strong>UPLOAD</strong> tab, extract them, then return here.</p>
          </div>
        </Panel>
        {commentPanel}
      </div>
    );
  }

  // ── No projections uploaded — show AI model output ────────────────────────
  if (projRows.length === 0 && model) {
    return (
      <div className="space-y-3">
        {importPanel}
        <EstimatedView caseId={cc.id} model={model} histPL={histPL} unit={unit} abbr={abbr} unitTicker={unitTicker}
          busy={busy} progress={progress} progressLabel={progressLabel} onGenerateNote={onGenerateNote} />
        {commentPanel}
      </div>
    );
  }

  // ── Projections uploaded — full view + sanity check ───────────────────────
  const projData = uploadedYears.map(fy => {
    const items = ((projRows.find(r => r.fiscal_year === fy)?.line_items ?? []) as unknown as LineItem[]);
    return {
      fy,
      turnover:  liVal(items, "Projected Turnover"),
      ebitda:    liVal(items, "Projected EBITDA"),
      pat:       liVal(items, "Projected PAT"),
      networth:  liVal(items, "Projected Net Worth"),
      totalDebt: liVal(items, "Projected Total Debt"),
    };
  });

  const projMetrics = projData.map((d, i) => {
    const prev = i > 0 ? projData[i - 1] : null;
    return {
      ...d,
      ebitdaMargin: d.turnover && d.ebitda    ? (d.ebitda / d.turnover) * 100 : null,
      patMargin:    d.turnover && d.pat        ? (d.pat    / d.turnover) * 100 : null,
      debtEbitda:   d.ebitda && d.ebitda !== 0 && d.totalDebt ? d.totalDebt / d.ebitda : null,
      roe:          d.networth && d.networth !== 0 && d.pat ? (d.pat / d.networth) * 100 : null,
      revGrowth:    prev?.turnover && d.turnover && prev.turnover !== 0
        ? ((d.turnover - prev.turnover) / Math.abs(prev.turnover)) * 100 : null,
    };
  });

  const nY     = projData.length - 1;
  const revCAGR = cagr(projData[0]?.turnover ?? null, projData[nY]?.turnover ?? null, nY);
  const final  = projMetrics[projMetrics.length - 1];

  const histYears = [...new Set(histPL.map(r => r.fiscal_year))].sort();
  const histDataBridge = histYears.map(fy => {
    const pl = ((histPL.find(r => r.fiscal_year === fy)?.line_items ?? []) as unknown as LineItem[]);
    return { label: `FY${fy}`, actual: liVal(pl, "Turnover"), projected: null as number | null };
  });
  const bridgeData = [
    ...histDataBridge,
    ...projData.map(d => ({ label: `FY${d.fy}*`, actual: null as number | null, projected: d.turnover })),
  ];
  const lastHistLabel = histDataBridge.length ? histDataBridge[histDataBridge.length - 1].label : null;

  const revenueData = projMetrics.map(d => ({
    fy: `FY${d.fy}`, turnover: d.turnover,
    growth: d.revGrowth != null ? +d.revGrowth.toFixed(1) : null,
  }));
  const marginsData = projMetrics.map(d => ({
    fy: `FY${d.fy}`,
    ebitdaMargin: d.ebitdaMargin != null ? +d.ebitdaMargin.toFixed(1) : null,
    patMargin:    d.patMargin    != null ? +d.patMargin.toFixed(1)    : null,
  }));
  const debtData = projMetrics.map(d => ({
    fy: `FY${d.fy}`, totalDebt: d.totalDebt,
    debtEbitda: d.debtEbitda != null ? +d.debtEbitda.toFixed(2) : null,
  }));

  const debtClr = (v: number | null | undefined) =>
    v == null ? "text-foreground/50" : v < 3 ? "text-success" : v < 5 ? "text-warning" : "text-destructive";

  const projLineItems = ["Projected Turnover","Projected EBITDA","Projected PAT","Projected Net Worth","Projected Total Debt"];
  const analyticsRows = [
    { label: "EBITDA Margin",           fn: (m: typeof projMetrics[0]) => pct(m.ebitdaMargin) },
    { label: "PAT / Net Profit Margin", fn: (m: typeof projMetrics[0]) => pct(m.patMargin) },
    { label: "Return on Net Worth",     fn: (m: typeof projMetrics[0]) => pct(m.roe) },
    { label: "Debt / EBITDA",           fn: (m: typeof projMetrics[0]) => m.debtEbitda != null ? m.debtEbitda.toFixed(2) + "x" : "—" },
    { label: "Revenue Growth YoY",      fn: (m: typeof projMetrics[0]) => m.revGrowth != null ? (m.revGrowth > 0 ? "+" : "") + m.revGrowth.toFixed(1) + "%" : "—" },
  ];

  // Sanity check
  const riskFlags = model ? assessRisks(projData, model, abbr ? ` ${abbr}` : "") : [];
  const sanityRows = [
    { label: "Turnover",   uk: "turnover"  as const, ek: "turnover"  as const },
    { label: "EBITDA",     uk: "ebitda"    as const, ek: "ebitda"    as const },
    { label: "PAT",        uk: "pat"       as const, ek: "pat"       as const },
    { label: "Net Worth",  uk: "networth"  as const, ek: "networth"  as const },
    { label: "Total Debt", uk: "totalDebt" as const, ek: "totalDebt" as const },
  ];

  // Overall accuracy verdict
  const keyVarPcts: number[] = [];
  for (const { uk, ek } of sanityRows.slice(0, 3)) {
    for (const d of projData) {
      const est = model?.points.find(e => e.fy === d.fy);
      const vi = varInfo(d[uk] as number | null, est?.[ek] as number | null ?? null);
      if (vi.pct != null) keyVarPcts.push(vi.pct);
    }
  }
  const avgVar  = keyVarPcts.length ? keyVarPcts.reduce((a, b) => a + b) / keyVarPcts.length : null;
  const absAvg  = avgVar != null ? Math.abs(avgVar) : null;
  const verdict = absAvg == null ? { text: "—", cls: "text-muted-foreground", note: "Insufficient comparison data." }
    : absAvg < 15  ? { text: "✓ REASONABLE",        cls: "text-success",     note: `Projections within ±15 % of model estimates. Avg deviation ${avgVar!.toFixed(1)}%.` }
    : absAvg < 35  ? { text: avgVar! > 0 ? "⚠ OPTIMISTIC" : "⚠ CONSERVATIVE", cls: "text-warning",
                        note: `Projections deviate ${avgVar! > 0 ? "above" : "below"} model by ~${absAvg.toFixed(1)}% on average. Review assumptions.` }
    : { text: avgVar! > 0 ? "✕ VERY OPTIMISTIC" : "✕ VERY CONSERVATIVE", cls: "text-destructive",
        note: `Projections deviate ${avgVar! > 0 ? "significantly above" : "significantly below"} model by ~${absAvg.toFixed(1)}% on average. Requires strong justification.` };

  const compChartData = uploadedYears.map(fy => ({
    fy: `FY${fy}`,
    uploaded:  projData.find(d => d.fy === fy)?.turnover ?? null,
    estimated: model?.points.find(e => e.fy === fy)?.turnover ?? null,
    upper:     model?.points.find(e => e.fy === fy)?.upper ?? null,
    lower:     model?.points.find(e => e.fy === fy)?.lower ?? null,
  }));

  return (
    <div className="space-y-3">

      {importPanel}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Panel title="REVENUE CAGR" ticker={nY > 0 ? `${nY}Y PROJ` : "1Y"}>
          <div className={`text-2xl font-bold glow ${revCAGR != null && revCAGR > 0 ? "text-success" : "text-destructive"}`}>
            {revCAGR != null ? (revCAGR > 0 ? "+" : "") + revCAGR.toFixed(1) + "%" : "—"}
          </div>
          <div className="terminal-label mt-1">Projected period</div>
        </Panel>
        <Panel title="FINAL EBITDA %" ticker={`FY${final?.fy ?? "—"}`}>
          <div className="text-2xl font-bold text-warning glow">{pct(final?.ebitdaMargin)}</div>
          <div className="terminal-label mt-1">Last projected FY</div>
        </Panel>
        <Panel title="FINAL PAT %" ticker={`FY${final?.fy ?? "—"}`}>
          <div className={`text-2xl font-bold glow ${(final?.patMargin ?? 0) > 0 ? "text-success" : "text-destructive"}`}>
            {pct(final?.patMargin)}
          </div>
          <div className="terminal-label mt-1">Last projected FY</div>
        </Panel>
        <Panel title="DEBT / EBITDA" ticker={`FY${final?.fy ?? "—"}`}>
          <div className={`text-2xl font-bold glow ${debtClr(final?.debtEbitda)}`}>
            {final?.debtEbitda != null ? final.debtEbitda.toFixed(2) + "x" : "—"}
          </div>
          <div className="terminal-label mt-1">Last projected FY</div>
        </Panel>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-2 gap-3">
        <Panel title="PROJECTED REVENUE GROWTH" ticker="TURNOVER">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={revenueData} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="fy" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis yAxisId="l" tick={{ fill: "#6b7280", fontSize: 10 }} width={55} />
                <YAxis yAxisId="r" orientation="right" tick={{ fill: "#f59e0b", fontSize: 10 }} unit="%" width={38} />
                <RTooltip contentStyle={TT} />
                <Bar  yAxisId="l" dataKey="turnover" fill="#22c55e" opacity={0.85} name="Turnover" radius={[2,2,0,0]} />
                <Line yAxisId="r" type="monotone" dataKey="growth" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 3 }} name="Growth %" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[9px] text-muted-foreground mt-1">▸ Bars = revenue · Amber = YoY growth %</div>
        </Panel>

        <Panel title="PROJECTED MARGIN TREND" ticker="EBITDA + PAT">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={marginsData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="fy" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} unit="%" width={40} />
                <RTooltip contentStyle={TT} formatter={(v: number) => v.toFixed(1) + "%"} />
                <Legend wrapperStyle={{ fontSize: 10, color: "#9ca3af" }} />
                <Line type="monotone" dataKey="ebitdaMargin" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 3 }} name="EBITDA %" connectNulls />
                <Line type="monotone" dataKey="patMargin"    stroke="#60a5fa" strokeWidth={2} dot={{ fill: "#60a5fa", r: 3 }} name="PAT %"   connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[9px] text-muted-foreground mt-1">▸ Amber = EBITDA margin · Blue = PAT margin</div>
        </Panel>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-2 gap-3">
        <Panel title="HISTORICAL vs PROJECTED REVENUE" ticker="BRIDGE">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bridgeData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} width={55} />
                <RTooltip contentStyle={TT} />
                {lastHistLabel && <ReferenceLine x={lastHistLabel} stroke="#374151" strokeDasharray="4 2" label={{ value: "PROJ →", fill: "#6b7280", fontSize: 9 }} />}
                <Bar dataKey="actual"    fill="#4b5563" name="Actual"    radius={[2,2,0,0]} />
                <Bar dataKey="projected" fill="#22c55e" opacity={0.7}  name="Projected" radius={[2,2,0,0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[9px] text-muted-foreground mt-1">▸ Grey = historical actuals · Green = projections</div>
        </Panel>

        <Panel title="DEBT TRAJECTORY" ticker="TOTAL DEBT + COVERAGE">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={debtData} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="fy" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis yAxisId="l" tick={{ fill: "#6b7280", fontSize: 10 }} width={55} />
                <YAxis yAxisId="r" orientation="right" tick={{ fill: "#f59e0b", fontSize: 10 }} unit="x" width={38} />
                <RTooltip contentStyle={TT} />
                <Bar  yAxisId="l" dataKey="totalDebt"  fill="#ef4444" opacity={0.6} name="Total Debt" radius={[2,2,0,0]} />
                <Line yAxisId="r" type="monotone" dataKey="debtEbitda" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 3 }} name="Debt/EBITDA" connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[9px] text-muted-foreground mt-1">▸ Red = total debt · Amber = Debt/EBITDA</div>
        </Panel>
      </div>

      {/* Projected Financials Table */}
      <Panel title="PROJECTED FINANCIAL STATEMENTS" ticker={unitTicker || "DOC UNITS"}>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left py-1">LINE ITEM</th>
              {uploadedYears.map(y => <th key={y} className="text-right">FY{y}</th>)}
              {nY > 0 && <th className="text-right text-accent">CAGR</th>}
            </tr>
          </thead>
          <tbody>
            {projLineItems.map(label => {
              const values = uploadedYears.map(fy =>
                liVal(((projRows.find(r => r.fiscal_year === fy)?.line_items ?? []) as unknown as LineItem[]), label));
              const ic = cagr(values[0] ?? null, values[values.length - 1] ?? null, nY);
              return (
                <tr key={label} className="border-b border-border/30">
                  <td className="py-1.5 text-foreground/90 font-medium">{label}</td>
                  {values.map((v, i) => (
                    <td key={uploadedYears[i]} className="text-right tabular-nums text-primary">
                      {fmt(v)}{abbr && v != null && <span className="text-[9px] text-muted-foreground ml-0.5">{abbr}</span>}
                    </td>
                  ))}
                  {nY > 0 && (
                    <td className={`text-right tabular-nums font-bold text-[10px] ${ic != null && ic > 0 ? "text-success" : ic != null && ic < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {ic != null ? (ic > 0 ? "+" : "") + ic.toFixed(1) + "%" : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {/* Analytics Matrix */}
      <Panel title="PROJECTION ANALYTICS MATRIX" ticker={unitTicker ? `DERIVED RATIOS · ${unitTicker}` : "DERIVED RATIOS"}>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left py-1">METRIC</th>
              {uploadedYears.map(y => <th key={y} className="text-right pr-2">FY{y}</th>)}
            </tr>
          </thead>
          <tbody>
            {analyticsRows.map(({ label, fn }) => (
              <tr key={label} className="border-b border-border/30">
                <td className="py-1.5 text-foreground/90">{label}</td>
                {projMetrics.map(m => <td key={m.fy} className="text-right tabular-nums text-primary pr-2">{fn(m)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* ── COMBINED AI MODEL vs MANAGEMENT PROJECTIONS ─────────────────────── */}
      {model && (() => {
        // Build one data point per FY combining both sources
        const combined = uploadedYears.map(fy => {
          const up = projData.find(d => d.fy === fy);
          const md = model.points.find(p => p.fy === fy);
          const mEM = md?.turnover && md.ebitda != null ? +((md.ebitda / md.turnover) * 100).toFixed(1) : null;
          const mPM = md?.turnover && md.pat    != null ? +((md.pat    / md.turnover) * 100).toFixed(1) : null;
          const uEM = up?.turnover && up.ebitda != null ? +((up.ebitda / up.turnover) * 100).toFixed(1) : null;
          const uPM = up?.turnover && up.pat    != null ? +((up.pat    / up.turnover) * 100).toFixed(1) : null;
          return {
            fy:               `FY${fy}`,
            modelTurnover:    md?.turnover    ?? null,
            uploadTurnover:   up?.turnover    ?? null,
            modelEbitdaMargin: mEM,
            uploadEbitdaMargin: uEM,
            modelPatMargin:    mPM,
            uploadPatMargin:   uPM,
          };
        });

        // Auto-signal detection
        type InsightType = "OPPORTUNITY" | "RISK" | "GAP" | "IN LINE";
        const insights: Array<{ type: InsightType; metric: string; detail: string }> = [];
        const avgDev = (getU: (d: typeof combined[0]) => number | null, getM: (d: typeof combined[0]) => number | null) => {
          const vals = combined.map(d => {
            const u = getU(d), m = getM(d);
            return u != null && m != null && m !== 0 ? (u - m) / Math.abs(m) * 100 : null;
          }).filter((v): v is number => v != null);
          return vals.length ? vals.reduce((a, b) => a + b) / vals.length : null;
        };
        const classify = (dev: number | null, label: string) => {
          if (dev == null) return;
          const a = Math.abs(dev), s = dev > 0 ? "+" : "";
          if      (dev < -35) insights.push({ type: "OPPORTUNITY", metric: label, detail: `Management ${a.toFixed(1)}% below model — potential upside if model trend holds.` });
          else if (dev < -15) insights.push({ type: "GAP",         metric: label, detail: `${a.toFixed(1)}% below model. Conservative — confirm constraints with management.` });
          else if (dev >  35) insights.push({ type: "RISK",        metric: label, detail: `${s}${a.toFixed(1)}% above model. Highly optimistic — stress-test assumptions.` });
          else if (dev >  15) insights.push({ type: "RISK",        metric: label, detail: `${s}${a.toFixed(1)}% above model trend. Review growth drivers.` });
          else                insights.push({ type: "IN LINE",     metric: label, detail: `Within ±15% of model. Credible against historical trend.` });
        };
        classify(avgDev(d => d.uploadTurnover,    d => d.modelTurnover),    "Revenue");
        classify(avgDev(d => d.uploadEbitdaMargin, d => d.modelEbitdaMargin), "EBITDA Margin");
        classify(avgDev(d => d.uploadPatMargin,    d => d.modelPatMargin),    "PAT Margin");

        const INS_CLS: Record<InsightType, string> = {
          OPPORTUNITY: "text-success", RISK: "text-destructive",
          GAP: "text-warning", "IN LINE": "text-muted-foreground",
        };
        const INS_COL: Record<InsightType, string> = {
          OPPORTUNITY: "hsl(var(--success))", RISK: "hsl(var(--destructive))",
          GAP: "hsl(var(--warning))", "IN LINE": "hsl(var(--muted-foreground))",
        };

        return (
          <Panel title="AI MODEL vs MANAGEMENT PROJECTIONS" ticker="COMBINED VIEW · REVENUE + MARGINS">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={combined} margin={{ top: 4, right: 52, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="fy" tick={{ fill: "#6b7280", fontSize: 10 }} />
                  {/* Left axis — revenue */}
                  <YAxis yAxisId="rev" tick={{ fill: "#6b7280", fontSize: 10 }} width={58}
                    tickFormatter={v => v >= 1e7 ? `${(v/1e7).toFixed(0)}Cr` : v >= 1e5 ? `${(v/1e5).toFixed(0)}L` : String(v)} />
                  {/* Right axis — margin % */}
                  <YAxis yAxisId="pct" orientation="right" tick={{ fill: "#6b7280", fontSize: 10 }} unit="%" width={40} />
                  <RTooltip contentStyle={TT}
                    formatter={(v: number, name: string) =>
                      name.includes("Margin") || name.includes("margin")
                        ? [`${v.toFixed(1)}%`, name]
                        : [v.toLocaleString("en-IN", { maximumFractionDigits: 0 }), name]
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 10, color: "#9ca3af" }} />
                  {/* Revenue bars — grouped */}
                  <Bar yAxisId="rev" dataKey="modelTurnover"  name="Revenue · AI Model"  fill="#818cf8" opacity={0.65} radius={[2,2,0,0]} />
                  <Bar yAxisId="rev" dataKey="uploadTurnover" name="Revenue · Mgmt Upload" fill="#22c55e" opacity={0.80} radius={[2,2,0,0]} />
                  {/* EBITDA margin lines */}
                  <Line yAxisId="pct" type="monotone" dataKey="modelEbitdaMargin"  name="EBITDA% · AI Model"  stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3" dot={{ fill: "#f59e0b", r: 3 }} connectNulls />
                  <Line yAxisId="pct" type="monotone" dataKey="uploadEbitdaMargin" name="EBITDA% · Upload"     stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b", r: 4, strokeWidth: 2, stroke: "#0d1117" }} connectNulls />
                  {/* PAT margin lines */}
                  <Line yAxisId="pct" type="monotone" dataKey="modelPatMargin"  name="PAT% · AI Model"  stroke="#60a5fa" strokeWidth={2} strokeDasharray="5 3" dot={{ fill: "#60a5fa", r: 3 }} connectNulls />
                  <Line yAxisId="pct" type="monotone" dataKey="uploadPatMargin" name="PAT% · Upload"     stroke="#60a5fa" strokeWidth={2} dot={{ fill: "#60a5fa", r: 4, strokeWidth: 2, stroke: "#0d1117" }} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[9px] text-muted-foreground/50 mt-1 mb-3 flex flex-wrap gap-x-4">
              <span>▸ Bars = revenue (left axis) — purple AI model · green management upload</span>
              <span>▸ Lines = margin % (right axis) — dashed AI model · solid upload · amber EBITDA · blue PAT</span>
            </div>

            {/* Auto-detected signals inline below chart */}
            {insights.length > 0 && (
              <div className="border-t border-border/30 pt-2 space-y-1.5">
                <div className="text-[9px] text-muted-foreground tracking-widest font-bold mb-1.5">DETECTED SIGNALS</div>
                <div className="grid grid-cols-3 gap-2">
                  {insights.map((ins, i) => (
                    <div key={i} className="border-l-2 pl-2 py-0.5" style={{ borderColor: INS_COL[ins.type] }}>
                      <div className={`text-[9px] font-bold tracking-wider ${INS_CLS[ins.type]}`}>{ins.type} · {ins.metric}</div>
                      <div className="text-[9px] text-muted-foreground/60 leading-relaxed mt-0.5">{ins.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        );
      })()}

      {/* ── PROJECTION SANITY CHECK ──────────────────────────────────────────── */}
      {model && (
        <Panel title="PROJECTION SANITY CHECK" ticker={`${METHOD_LABEL[model.method]} · ${model.histYears}yr history`}>

          {/* Model quality + overall verdict */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className={`border px-3 py-2 text-[10px] tracking-widest font-bold ${CONF_CLS[model.confidence]}`}>
              MODEL CONFIDENCE: {model.confidence}
              <div className="font-normal text-[9px] mt-0.5 opacity-70">
                {METHOD_LABEL[model.method]}{model.r2 != null ? ` · R² = ${model.r2.toFixed(2)}` : ""}{model.rmse != null ? ` · RMSE = ${fmt(model.rmse)}${abbr ? ` ${abbr}` : ""}` : ""}
              </div>
            </div>
            <div className={`border px-3 py-2 ${verdict.cls} border-current/30 bg-current/5`}>
              <div className={`text-[10px] tracking-widest font-bold ${verdict.cls}`}>{verdict.text}</div>
              <div className="text-[9px] text-muted-foreground/70 mt-0.5">{verdict.note}</div>
            </div>
          </div>

          {/* AI model assumptions */}
          <div className="mb-3 text-[9px] text-muted-foreground/50 flex flex-wrap gap-x-4 gap-y-0.5">
            <span>▸ Base FY: {model.baseFY}</span>
            <span>▸ Revenue growth: {model.avgGrowthPct.toFixed(1)}% p.a.</span>
            {model.avgEbitdaMarginPct != null && <span>▸ EBITDA margin: {model.avgEbitdaMarginPct.toFixed(1)}%{model.ebitdaTrend ? ` (${model.ebitdaTrend})` : ""}</span>}
            {model.avgPatMarginPct    != null && <span>▸ PAT margin: {model.avgPatMarginPct.toFixed(1)}%{model.patTrend ? ` (${model.patTrend})` : ""}</span>}
            <span>▸ Debt: held flat (repayment unknown)</span>
          </div>

          {/* Uploaded vs Estimated turnover chart with confidence band */}
          {compChartData.length > 0 && (
            <div className="mb-3">
              <div className="text-[9px] tracking-widest text-muted-foreground mb-1.5">TURNOVER: UPLOADED vs AI MODEL (with 90 % confidence band)</div>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={compChartData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="fy" tick={{ fill: "#6b7280", fontSize: 10 }} />
                    <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} width={55} />
                    <RTooltip contentStyle={TT} />
                    <Legend wrapperStyle={{ fontSize: 10, color: "#9ca3af" }} />
                    {/* Confidence band as area */}
                    <Area type="monotone" dataKey="upper" fill="#818cf8" stroke="none" fillOpacity={0.12} name="Upper 90%" legendType="none" />
                    <Area type="monotone" dataKey="lower" fill="#0d1117" stroke="none" fillOpacity={1}    name="Lower 90%" legendType="none" />
                    <Line type="monotone" dataKey="upper"     stroke="#818cf8" strokeWidth={1} strokeDasharray="3 2" dot={false} name="Upper CI" />
                    <Line type="monotone" dataKey="lower"     stroke="#818cf8" strokeWidth={1} strokeDasharray="3 2" dot={false} name="Lower CI" />
                    <Line type="monotone" dataKey="estimated" stroke="#818cf8" strokeWidth={2} dot={{ fill: "#818cf8", r: 3 }} name="AI Estimate" />
                    <Bar  dataKey="uploaded"  fill="#22c55e" opacity={0.85} name="Uploaded" radius={[2,2,0,0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="text-[9px] text-muted-foreground mt-1">▸ Green bars = uploaded · Purple line = AI estimate · Shaded = 90% prediction interval</div>
            </div>
          )}

          {/* Metric-by-metric variance table */}
          <table className="w-full text-xs mb-3">
            <thead className="text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left py-1 min-w-[100px]">METRIC</th>
                {uploadedYears.map(y => (
                  <th key={y} colSpan={3} className="text-center border-l border-border/30 py-1 px-1">FY{y}</th>
                ))}
              </tr>
              <tr className="text-[9px]">
                <th />
                {uploadedYears.map(y => [
                  <th key={`${y}-u`} className="text-right text-primary/70 border-l border-border/20 pr-1 pb-1">UPLOADED</th>,
                  <th key={`${y}-e`} className="text-right text-accent/60 pr-1 pb-1">AI MODEL</th>,
                  <th key={`${y}-v`} className="text-right pr-2 pb-1">VAR %</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {sanityRows.map(({ label, uk, ek }) => (
                <tr key={label} className="border-b border-border/20 hover:bg-surface/30">
                  <td className="py-1.5 text-foreground/80 font-medium">{label}</td>
                  {uploadedYears.map(fy => {
                    const up  = projData.find(d => d.fy === fy)?.[uk] as number | null ?? null;
                    const est = model.points.find(e => e.fy === fy)?.[ek] as number | null ?? null;
                    const vi  = varInfo(up, est);
                    return [
                      <td key={`${fy}-u`} className="text-right tabular-nums text-primary border-l border-border/20 pr-1">
                        {fmt(up)}{abbr && up != null && <span className="text-[8px] text-muted-foreground ml-0.5">{abbr}</span>}
                      </td>,
                      <td key={`${fy}-e`} className="text-right tabular-nums text-accent/60 pr-1">
                        {fmt(est)}{abbr && est != null && <span className="text-[8px] text-muted-foreground ml-0.5">{abbr}</span>}
                      </td>,
                      <td key={`${fy}-v`} className={`text-right tabular-nums font-semibold text-[10px] pr-2 ${vi.cls}`}>
                        {vi.label}{vi.verdict ? <span className="text-[8px] opacity-70 ml-1">{vi.verdict}</span> : null}
                      </td>,
                    ];
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Risk Flags */}
          {riskFlags.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[9px] tracking-widest text-muted-foreground font-bold mb-1">RISK FLAGS</div>
              {riskFlags.map(flag => (
                <div key={flag.id} className="flex gap-2 items-start border-l-2 border-current pl-2 py-0.5" style={{ borderColor: flag.severity === "HIGH" ? "hsl(var(--destructive))" : flag.severity === "MEDIUM" ? "hsl(var(--warning))" : "hsl(var(--muted-foreground))" }}>
                  <span className={`text-[9px] font-bold tracking-wider min-w-[44px] ${SEV_CLS[flag.severity]}`}>{flag.severity}</span>
                  <div>
                    <div className={`text-[10px] font-semibold ${SEV_CLS[flag.severity]}`}>{flag.title}</div>
                    <div className="text-[9px] text-muted-foreground/60">{flag.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="text-[9px] text-muted-foreground/40 mt-3 pt-2 border-t border-border/20">
            ▸ AI model: {METHOD_LABEL[model.method]} on {model.histYears} yr(s) of historical data.
            GREEN ±15% · AMBER 15–35% · RED &gt;35% variance from model.
            Positive variance = uploaded exceeds AI estimate.
          </div>
        </Panel>
      )}

      <ProjectionChatPanel
        caseId={cc.id}
        model={model}
        projData={projData}
        riskFlags={riskFlags}
        verdict={verdict}
        abbr={abbr}
      />

      {commentPanel}
      <IcNoteButton busy={busy} progress={progress} progressLabel={progressLabel} onGenerateNote={onGenerateNote} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ESTIMATED VIEW (no projections uploaded)
// ═══════════════════════════════════════════════════════════════════════════════

function EstimatedView({ caseId, model, histPL, unit, abbr, unitTicker, busy, progress, progressLabel, onGenerateNote }: {
  caseId: string;
  model: ModelOutput;
  histPL: ExtractedRow[];
  unit: string | null;
  abbr: string;
  unitTicker: string;
  busy: boolean;
  progress: number;
  progressLabel: string;
  onGenerateNote: () => void;
}) {
  const { points: est } = model;
  const estYears = est.map(p => p.fy);
  const nY = est.length - 1;
  const revCAGR = cagr(est[0]?.turnover ?? null, est[nY]?.turnover ?? null, nY);
  const last    = est[est.length - 1];
  const lastEM  = last.turnover && last.ebitda ? (last.ebitda / last.turnover) * 100 : null;
  const lastPM  = last.turnover && last.pat    ? (last.pat    / last.turnover) * 100 : null;
  const lastDE  = last.ebitda && last.ebitda !== 0 && last.totalDebt ? last.totalDebt / last.ebitda : null;
  const debtClr = (v: number | null | undefined) =>
    v == null ? "text-foreground/50" : v < 3 ? "text-success" : v < 5 ? "text-warning" : "text-destructive";

  const histYears = [...new Set(histPL.map(r => r.fiscal_year))].sort();
  const histBridge = histYears.map(fy => {
    const pl = ((histPL.find(r => r.fiscal_year === fy)?.line_items ?? []) as unknown as LineItem[]);
    const tv = (pl).find(i => i.label === "Turnover");
    const v  = tv ? (tv.override_value ?? tv.value) : null;
    return { label: `FY${fy}`, actual: v, upper: null as number | null, lower: null as number | null, est: null as number | null };
  });
  const estBridge = est.map(p => ({ label: `FY${p.fy}*`, actual: null as number | null, upper: p.upper, lower: p.lower, est: p.turnover }));
  const bridgeData = [...histBridge, ...estBridge];
  const lastHistLabel = histBridge.length ? histBridge[histBridge.length - 1].label : null;

  const growthLbl = { ols_regression: `OLS Regression (R²=${model.r2?.toFixed(2) ?? "—"})`, holt_winters: "Holt-Winters Smoothing", cagr: "CAGR (1yr)", default: "Default 10%" }[model.method];
  const projLineItems = ["Projected Turnover","Projected EBITDA","Projected PAT","Projected Net Worth","Projected Total Debt"] as const;
  const estKeyMap: Record<string, keyof ProjectionPoint> = {
    "Projected Turnover":"turnover","Projected EBITDA":"ebitda","Projected PAT":"pat",
    "Projected Net Worth":"networth","Projected Total Debt":"totalDebt",
  };

  return (
    <div className="space-y-3">

      {/* AI Estimate Banner */}
      <div className="border border-accent/50 bg-accent/5 px-3 py-2 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] tracking-widest text-accent font-bold">⚡ AI-ESTIMATED PROJECTIONS</span>
          <span className={`text-[9px] border px-1.5 py-0.5 font-bold tracking-wider ${CONF_CLS[model.confidence]}`}>
            {model.confidence} CONFIDENCE
          </span>
        </div>
        <div className="text-[9px] text-muted-foreground/70">
          No projection document uploaded. Figures below are AI-modelled from historical data.
          Upload management projections in the <strong>UPLOAD</strong> tab to enable accuracy comparison.
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[9px] text-muted-foreground/50 pt-0.5">
          <span>▸ Model: {growthLbl}</span>
          <span>▸ Base FY: {model.baseFY} · {model.histYears} yr(s) history</span>
          <span>▸ Growth: {model.avgGrowthPct.toFixed(1)}% p.a.</span>
          {model.avgEbitdaMarginPct != null && <span>▸ EBITDA margin: {model.avgEbitdaMarginPct.toFixed(1)}%{model.ebitdaTrend ? ` (${model.ebitdaTrend})` : ""}</span>}
          {model.avgPatMarginPct    != null && <span>▸ PAT margin: {model.avgPatMarginPct.toFixed(1)}%{model.patTrend ? ` (${model.patTrend})` : ""}</span>}
          <span>▸ Debt: flat (repayment unknown)</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Panel title="REVENUE CAGR" ticker={`${est.length}Y ESTIMATE`}>
          <div className={`text-2xl font-bold glow ${revCAGR != null && revCAGR > 0 ? "text-success" : "text-destructive"}`}>
            {revCAGR != null ? (revCAGR > 0 ? "+" : "") + revCAGR.toFixed(1) + "%" : "—"}
          </div>
          <div className="terminal-label mt-1">Estimated period</div>
        </Panel>
        <Panel title="FINAL EBITDA %" ticker={`FY${last?.fy ?? "—"} EST`}>
          <div className="text-2xl font-bold text-warning glow">{pct(lastEM)}</div>
          <div className="terminal-label mt-1">Last estimated FY</div>
        </Panel>
        <Panel title="FINAL PAT %" ticker={`FY${last?.fy ?? "—"} EST`}>
          <div className={`text-2xl font-bold glow ${(lastPM ?? 0) > 0 ? "text-success" : "text-destructive"}`}>
            {pct(lastPM)}
          </div>
          <div className="terminal-label mt-1">Last estimated FY</div>
        </Panel>
        <Panel title="DEBT / EBITDA" ticker={`FY${last?.fy ?? "—"} EST`}>
          <div className={`text-2xl font-bold glow ${debtClr(lastDE)}`}>
            {lastDE != null ? lastDE.toFixed(2) + "x" : "—"}
          </div>
          <div className="terminal-label mt-1">Last estimated FY</div>
        </Panel>
      </div>

      {/* Revenue + Confidence Band chart */}
      <Panel title="ESTIMATED REVENUE WITH CONFIDENCE BAND" ticker="90% PREDICTION INTERVAL">
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={bridgeData} margin={{ top: 4, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 10 }} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} width={55} />
              <RTooltip contentStyle={TT} />
              <Legend wrapperStyle={{ fontSize: 10, color: "#9ca3af" }} />
              {lastHistLabel && <ReferenceLine x={lastHistLabel} stroke="#374151" strokeDasharray="4 2" label={{ value: "EST →", fill: "#6b7280", fontSize: 9 }} />}
              <Area type="monotone" dataKey="upper" fill="#818cf8" stroke="none" fillOpacity={0.15} legendType="none" />
              <Area type="monotone" dataKey="lower" fill="#0d1117" stroke="none" fillOpacity={1}    legendType="none" />
              <Bar  dataKey="actual" fill="#4b5563" name="Actual"    radius={[2,2,0,0]} />
              <Bar  dataKey="est"    fill="#818cf8" opacity={0.8}  name="AI Estimate" radius={[2,2,0,0]} />
              <Line type="monotone" dataKey="upper" stroke="#818cf8" strokeWidth={1} strokeDasharray="3 2" dot={false} name="Upper 90%" />
              <Line type="monotone" dataKey="lower" stroke="#818cf8" strokeWidth={1} strokeDasharray="3 2" dot={false} name="Lower 90%" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[9px] text-muted-foreground mt-1">▸ Grey = historical · Purple = AI estimate · Shaded = 90% prediction interval</div>
      </Panel>

      {/* Estimated Financials Table */}
      <Panel title="AI-ESTIMATED FINANCIAL PROJECTIONS" ticker={unitTicker || "DOC UNITS"}>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left py-1">LINE ITEM</th>
              {estYears.map(y => <th key={y} className="text-right text-accent">FY{y} EST</th>)}
              {nY > 0 && <th className="text-right text-accent/60 text-[9px]">CAGR</th>}
              <th className="text-right text-muted-foreground/50 text-[9px]">+90% CI</th>
              <th className="text-right text-muted-foreground/50 text-[9px]">−90% CI</th>
            </tr>
          </thead>
          <tbody>
            {projLineItems.map(label => {
              const key = estKeyMap[label];
              const values = est.map(p => p[key] as number | null);
              const ic = cagr(values[0] ?? null, values[values.length - 1] ?? null, nY);
              return (
                <tr key={label} className="border-b border-border/30">
                  <td className="py-1.5 text-foreground/90 font-medium">{label}</td>
                  {values.map((v, i) => (
                    <td key={estYears[i]} className="text-right tabular-nums text-accent/80">
                      {fmt(v)}{abbr && v != null && <span className="text-[9px] text-muted-foreground ml-0.5">{abbr}</span>}
                    </td>
                  ))}
                  {nY > 0 && (
                    <td className={`text-right tabular-nums font-bold text-[10px] ${ic != null && ic > 0 ? "text-success" : ic != null && ic < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {ic != null ? (ic > 0 ? "+" : "") + ic.toFixed(1) + "%" : "—"}
                    </td>
                  )}
                  {/* Only show CI for Turnover row */}
                  {label === "Projected Turnover" ? (
                    <>
                      <td className="text-right tabular-nums text-[10px] text-muted-foreground/50">{fmt(est[est.length-1].upper)}{abbr ? ` ${abbr}` : ""}</td>
                      <td className="text-right tabular-nums text-[10px] text-muted-foreground/50">{fmt(est[est.length-1].lower)}{abbr ? ` ${abbr}` : ""}</td>
                    </>
                  ) : <><td /><td /></>}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="text-[9px] text-muted-foreground/40 mt-2 pt-1 border-t border-border/20 italic">
          ▸ AI estimate only · {growthLbl} · Upload management projections to enable sanity check.
        </div>
      </Panel>

      <ProjectionChatPanel caseId={caseId} model={model} abbr={abbr} />

      <IcNoteButton busy={busy} progress={progress} progressLabel={progressLabel} onGenerateNote={onGenerateNote} />
    </div>
  );
}

// ─── Projection Chat Panel ────────────────────────────────────────────────────
function ProjectionChatPanel({
  caseId,
  model,
  projData,
  riskFlags,
  verdict,
  abbr,
}: {
  caseId: string;
  model: ModelOutput | null;
  projData?: Array<{ fy: number; turnover: number | null; ebitda: number | null; pat: number | null; networth: number | null; totalDebt: number | null }>;
  riskFlags?: RiskFlag[];
  verdict?: { text: string; cls: string; note: string };
  abbr: string;
}) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const buildContext = () => {
    const lines: string[] = ["=== PROJECTION ANALYSIS CONTEXT ==="];
    if (model) {
      lines.push(`\nAI/ML MODEL: ${METHOD_LABEL[model.method]}`);
      lines.push(`Confidence: ${model.confidence} | Base FY: ${model.baseFY} | History: ${model.histYears} year(s)`);
      if (model.r2 != null) lines.push(`R²: ${model.r2.toFixed(3)}${model.rmse != null ? ` | RMSE: ${model.rmse.toFixed(2)}${abbr ? ` ${abbr}` : ""}` : ""}`);
      lines.push(`Revenue growth: ${model.avgGrowthPct.toFixed(1)}% p.a.`);
      if (model.avgEbitdaMarginPct != null) lines.push(`EBITDA margin: ${model.avgEbitdaMarginPct.toFixed(1)}% (${model.ebitdaTrend ?? "stable"})`);
      if (model.avgPatMarginPct != null) lines.push(`PAT margin: ${model.avgPatMarginPct.toFixed(1)}% (${model.patTrend ?? "stable"})`);
      lines.push("\nAI Model Points:");
      for (const p of model.points) {
        const parts = [`FY${p.fy}:`];
        if (p.turnover != null) parts.push(`Turnover=${p.turnover.toFixed(2)}${abbr}`);
        if (p.ebitda != null) parts.push(`EBITDA=${p.ebitda.toFixed(2)}${abbr}`);
        if (p.pat != null) parts.push(`PAT=${p.pat.toFixed(2)}${abbr}`);
        if (p.upper != null && p.lower != null) parts.push(`90%CI=[${p.lower.toFixed(1)},${p.upper.toFixed(1)}]`);
        lines.push("  " + parts.join(" | "));
      }
    }
    if (projData && projData.length > 0) {
      lines.push("\nUPLOADED MANAGEMENT PROJECTIONS:");
      for (const d of projData) {
        const parts = [`FY${d.fy}:`];
        if (d.turnover != null) parts.push(`Turnover=${d.turnover.toFixed(2)}${abbr}`);
        if (d.ebitda != null) parts.push(`EBITDA=${d.ebitda.toFixed(2)}${abbr}`);
        if (d.pat != null) parts.push(`PAT=${d.pat.toFixed(2)}${abbr}`);
        if (d.networth != null) parts.push(`NetWorth=${d.networth.toFixed(2)}${abbr}`);
        if (d.totalDebt != null) parts.push(`Debt=${d.totalDebt.toFixed(2)}${abbr}`);
        lines.push("  " + parts.join(" | "));
      }
      if (verdict) {
        lines.push(`\nSanity Check: ${verdict.text}`);
        lines.push(verdict.note);
      }
      if (riskFlags && riskFlags.length > 0) {
        lines.push("\nRisk Flags:");
        for (const f of riskFlags) lines.push(`  [${f.severity}] ${f.title}: ${f.detail}`);
      }
    }
    lines.push("=== END CONTEXT ===");
    return lines.join("\n");
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user" as const, content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const base = (import.meta as unknown as { env: { VITE_SUPABASE_URL: string } }).env.VITE_SUPABASE_URL;
      const ctxMsg  = { role: "user" as const, content: buildContext() };
      const ctxAck  = { role: "assistant" as const, content: "Understood. I have the full projection context. Please ask your questions." };
      const apiMsgs = messages.length === 0
        ? [ctxMsg, ctxAck, userMsg]
        : [ctxMsg, ctxAck, ...newMessages];
      const res = await fetch(`${base}/functions/v1/analyst-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
        body: JSON.stringify({ case_id: caseId, page_name: "Projections", messages: apiMsgs }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { reply?: string; error?: string };
      if (data.error) throw new Error(data.error);
      setMessages(prev => [...prev, { role: "assistant", content: data.reply ?? "" }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel title="PROJECTION ANALYST CHAT" ticker="AI MODEL + UPLOAD COMPARISON">
      <div className="space-y-2">
        <div className="text-[9px] text-muted-foreground/60 pb-1 border-b border-border/30">
          Ask questions about the AI model, uploaded projections, sanity check, or assumptions. The AI has full context of both.
        </div>
        <div className="h-64 overflow-y-auto space-y-2 pr-1">
          {messages.length === 0 && (
            <div className="text-[10px] text-muted-foreground/40 text-center pt-10">
              Ask about growth assumptions, feasibility, risks, or compare AI model vs management projections…
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`text-[9px] font-bold tracking-wider min-w-[28px] pt-0.5 shrink-0 ${m.role === "user" ? "text-right text-primary" : "text-accent"}`}>
                {m.role === "user" ? "YOU" : "AI"}
              </div>
              <div className={`text-[10px] leading-relaxed whitespace-pre-wrap max-w-[85%] px-2 py-1.5 border ${
                m.role === "user"
                  ? "border-primary/30 bg-primary/5 text-foreground"
                  : "border-accent/20 bg-accent/5 text-foreground/90"
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-2">
              <div className="text-[9px] font-bold tracking-wider min-w-[28px] pt-0.5 text-accent">AI</div>
              <div className="text-[10px] text-muted-foreground/50 border border-accent/20 bg-accent/5 px-2 py-1.5 italic">Analysing…</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="flex gap-2 pt-1 border-t border-border/30">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
            placeholder="Ask about projections, assumptions, model vs uploaded…"
            disabled={loading}
            className="flex-1 bg-input border border-border text-foreground text-[10px] px-2 py-1.5 placeholder:text-muted-foreground/40 font-mono focus:outline-none focus:border-primary"
          />
          <button
            onClick={() => void handleSend()}
            disabled={loading || !input.trim()}
            className="bg-primary text-primary-foreground px-3 py-1.5 text-[10px] tracking-widest font-bold disabled:opacity-50"
          >
            {loading ? "…" : "SEND →"}
          </button>
        </div>
      </div>
    </Panel>
  );
}

// ─── Shared IC Note button ───────────────────────────────────────────────────
function IcNoteButton({ busy, progress, progressLabel, onGenerateNote }: {
  busy: boolean; progress: number; progressLabel: string; onGenerateNote: () => void;
}) {
  return (
    <>
      {busy && (
        <div className="border border-primary/40 bg-primary/5 p-3 space-y-2">
          <div className="flex justify-between text-[11px] tracking-widest">
            <span className="text-primary">▸ {progressLabel || "DRAFTING IC NOTE"}</span>
            <span className="text-primary font-bold tabular-nums">{progress}%</span>
          </div>
          <div className="h-2 bg-input border border-border overflow-hidden">
            <div className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${progress}%`, boxShadow: "0 0 8px hsl(var(--primary))" }} />
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground tracking-widest">
            <span>PREP</span><span>ANALYSE</span><span>DRAFT</span><span>BUILD</span><span>DONE</span>
          </div>
        </div>
      )}
      <button onClick={onGenerateNote} disabled={busy}
        className="bg-primary text-primary-foreground px-4 py-2 text-xs tracking-widest font-bold disabled:opacity-50">
        {busy ? "DRAFTING..." : "[GENERATE 12-SECTION IC NOTE →]"}
      </button>
    </>
  );
}
