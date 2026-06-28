import React from "react";
import { SlideShell } from "./SlideShell";
import type { RatioRow } from "@/features/case/types";
import { RATIO_DISPLAY_NAMES } from "@/features/credit/domain";

const DS = {
  navy:    "#0F1B2D",
  gold:    "#F5C518",
  altRow:  "#F5F5F0",
  body:    "#1C1C1E",
  muted:   "#888888",
  bodyFont: "'Source Serif 4', Calibri, sans-serif",
} as const;

interface RowItem { label: string; text?: string; items?: string[] }
interface SectionTemplate { rows?: RowItem[]; headline?: string; bullets?: string[]; flags?: string[]; generated_at?: string }

interface KeyRatiosCardProps {
  ratios: RatioRow[];
  pageNumStart: number;
  template?: SectionTemplate;
  generating?: boolean;
  onGenerate?: () => void;
}

// ── Inline threshold re-evaluation (guards against stale DB threshold_status) ──
const THRESHOLDS: Record<string, { g: number; a: number; hi: boolean }> = {
  // Coverage
  dscr:                  { g: 1.5,  a: 1.25, hi: true  },
  interest_coverage:     { g: 3.0,  a: 1.5,  hi: true  },
  // Liquidity
  current_ratio:         { g: 1.5,  a: 1.0,  hi: true  },
  quick_ratio:           { g: 1.0,  a: 0.7,  hi: true  },
  cash_ratio:            { g: 0.5,  a: 0.2,  hi: true  },
  // Solvency
  debt_to_equity:        { g: 2.0,  a: 3.0,  hi: false },
  lt_debt_to_equity:     { g: 2.0,  a: 3.0,  hi: false },
  debt_to_assets:        { g: 0.60, a: 0.75, hi: false },
  debt_to_ebitda:        { g: 4.0,  a: 6.0,  hi: false },
  total_liab_to_networth:{ g: 1.5,  a: 3.0,  hi: false },
  // Profitability
  gross_margin:          { g: 0.30, a: 0.15, hi: true  },
  ebitda_margin:         { g: 0.15, a: 0.08, hi: true  },
  ebt_margin:            { g: 0.10, a: 0.05, hi: true  },
  net_profit_margin:     { g: 0.10, a: 0.05, hi: true  },
  roa:                   { g: 0.05, a: 0.02, hi: true  },
  roe:                   { g: 0.15, a: 0.08, hi: true  },
  roce:                  { g: 0.15, a: 0.08, hi: true  },
  roic:                  { g: 0.12, a: 0.06, hi: true  },
  ronw:                  { g: 0.12, a: 0.06, hi: true  },
  revenue_growth:        { g: 0.15, a: 0.0,  hi: true  },
  // Efficiency
  asset_turnover:        { g: 1.10, a: 0.70, hi: true  },
  capital_employed_turnover: { g: 1.60, a: 1.00, hi: true },
  fixed_assets_turnover: { g: 2.00, a: 1.00, hi: true  },
  receivables_turnover:  { g: 6.00, a: 3.00, hi: true  },
  debtor_days:           { g: 45,   a: 90,   hi: false },
  creditor_days:         { g: 60,   a: 90,   hi: true  },
  inventory_days:        { g: 60,   a: 90,   hi: false },
  // R-score
  r_score_composite:     { g: 2.0,  a: 1.0,  hi: true  },
};
function evalStatus(name: string, value: number | null, stored: string | null): string | null {
  if (value === null) return stored;
  const t = THRESHOLDS[name];
  if (!t) return stored;
  if (t.hi) return value >= t.g ? "green" : value >= t.a ? "amber" : "red";
  return value <= t.g ? "green" : value <= t.a ? "amber" : "red";
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string | null }) {
  if (!status || status === "na") return <span style={{ color: DS.muted }}>—</span>;
  const map: Record<string, { label: string; bg: string; color: string }> = {
    green: { label: "PASS",    bg: "#D1FAE5", color: "#065F46" },
    amber: { label: "CAUTION", bg: "#FEF3C7", color: "#92400E" },
    red:   { label: "FAIL",    bg: "#FEE2E2", color: "#991B1B" },
  };
  const cfg = map[status];
  if (!cfg) return <span style={{ color: DS.muted }}>—</span>;
  return (
    <span
      style={{
        display: "inline-block",
        background: cfg.bg,
        color: cfg.color,
        fontSize: 9,
        fontWeight: 700,
        padding: "2px 6px",
        borderRadius: 3,
        letterSpacing: "0.04em",
      }}
    >
      {cfg.label}
    </span>
  );
}

// ── Format ratio value for display ───────────────────────────────────────────
// Uses explicit canonical sets so name-includes heuristics don't misfire
// (e.g. "current_ratio" no longer treated as a percentage).
const PCT_NAMES = new Set([
  "gross_margin","ebitda_margin","ebt_margin","net_profit_margin",
  "roa","roe","roce","roic","ronw",
  "revenue_growth","return_on_fixed_assets",
  "raw_material_pct","employee_cost_pct","finance_cost_pct","other_expenses_pct",
]);
const DAYS_NAMES = new Set([
  "debtor_days","creditor_days","inventory_days","payable_days","cash_conversion_cycle",
]);
const R_SCORE_NAMES = new Set([
  "r_score_composite","r_score_wc_ta","r_score_re_ta","r_score_ebitda_ta","r_score_equity_ol",
]);

function fmtRatioVal(name: string, val: number | null): string {
  if (val == null || !Number.isFinite(Number(val))) return "—";
  if (DAYS_NAMES.has(name)) return `${Math.round(val)}d`;
  if (name === "working_capital") {
    // Stored in absolute rupees — convert to Lakhs for IC deck display
    const inLakhs = Math.abs(val) >= 100000 ? val / 100000 : val;
    return `₹${inLakhs.toLocaleString("en-IN", { maximumFractionDigits: 2 })}L`;
  }
  if (PCT_NAMES.has(name)) return `${(val * 100).toFixed(1)}%`;
  if (R_SCORE_NAMES.has(name)) return `${val.toFixed(2)}x`;
  return `${val.toFixed(2)}x`;
}

// ── Per-category ratio table ──────────────────────────────────────────────────
interface RatioCategoryPanelProps {
  roman: string;
  romanSuffix: string;
  title: string;
  pageNum: number;
  category: string;
  ratios: RatioRow[];
}

function RatioCategoryPanel({ roman, romanSuffix, title, pageNum, category, ratios }: RatioCategoryPanelProps) {
  const catRatios = ratios.filter(r => r.category === category);
  const years = Array.from(new Set(catRatios.map(r => r.fiscal_year))).sort();
  const names = Array.from(new Set(catRatios.map(r => r.ratio_name)));

  // Only show years that have at least one non-null value
  const meaningfulYears = years.filter(y =>
    catRatios.some(r => r.fiscal_year === y && r.ratio_value != null && Number(r.ratio_value) !== 0)
  );

  return (
    <SlideShell roman={`${roman}-${romanSuffix}`} title={title} pageNum={pageNum}>
      <div style={{ padding: "0 0 4px", fontFamily: DS.bodyFont }}>
        {catRatios.length === 0 ? (
          <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 11, color: DS.muted, fontStyle: "italic" }}>
            No data available for this category
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: DS.gold }}>
                <th style={{ padding: "7px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: DS.body, width: "26%" }}>Ratio</th>
                {meaningfulYears.map(y => (
                  <th key={y} style={{ padding: "7px 10px", textAlign: "right", fontSize: 10, fontWeight: 700, color: DS.body }}>FY{y}</th>
                ))}
                <th style={{ padding: "7px 10px", textAlign: "right", fontSize: 10, fontWeight: 700, color: DS.body }}>Benchmark</th>
                <th style={{ padding: "7px 10px", textAlign: "center", fontSize: 10, fontWeight: 700, color: DS.body }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {names.map((name, i) => {
                // Prefer the latest year with a real non-zero value.
                // Projected-year rows (FY+1, FY+2) often have 0.00 from compute-ratios
                // run on projection data — using them as "latest" causes wrong FAIL status.
                const latest =
                  catRatios
                    .filter(r => r.ratio_name === name && r.ratio_value != null && Number(r.ratio_value) !== 0)
                    .sort((a, b) => b.fiscal_year - a.fiscal_year)[0]
                  ??
                  catRatios
                    .filter(r => r.ratio_name === name)
                    .sort((a, b) => b.fiscal_year - a.fiscal_year)[0];
                return (
                  <tr key={name} style={{ background: i % 2 === 0 ? "#FFFFFF" : DS.altRow }}>
                    <td style={{ padding: "7px 12px", fontSize: 11, color: DS.body, borderBottom: "1px solid #EBEBEB" }}>
                      {RATIO_DISPLAY_NAMES[name] ?? name}
                    </td>
                    {meaningfulYears.map(y => {
                      const r = catRatios.find(x => x.ratio_name === name && x.fiscal_year === y);
                      const val = r?.ratio_value != null ? Number(r.ratio_value) : null;
                      return (
                        <td key={y} style={{ padding: "7px 10px", textAlign: "right", fontSize: 11, color: DS.body, borderBottom: "1px solid #EBEBEB", fontVariantNumeric: "tabular-nums" }}>
                          {fmtRatioVal(name, val)}
                        </td>
                      );
                    })}
                    <td style={{ padding: "7px 10px", textAlign: "right", fontSize: 11, color: DS.muted, borderBottom: "1px solid #EBEBEB", fontVariantNumeric: "tabular-nums" }}>
                      {latest?.benchmark != null ? fmtRatioVal(name, Number(latest.benchmark)) : "—"}
                    </td>
                    <td style={{ padding: "7px 10px", textAlign: "center", borderBottom: "1px solid #EBEBEB" }}>
                      <StatusBadge status={evalStatus(name, latest?.ratio_value != null ? Number(latest.ratio_value) : null, latest?.threshold_status ?? null)} />
                    </td>
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

const CATEGORIES: { category: string; suffix: string; title: string }[] = [
  { category: "coverage",     suffix: "a", title: "Key Ratios – Coverage Ratios" },
  { category: "liquidity",    suffix: "b", title: "Key Ratios – Liquidity Ratios" },
  { category: "solvency",     suffix: "c", title: "Key Ratios – Solvency Ratios" },
  { category: "profitability",suffix: "d", title: "Key Ratios – Profitability Ratios" },
  { category: "efficiency",   suffix: "e", title: "Key Ratios – Efficiency & Turnover" },
  { category: "expenses",     suffix: "f", title: "Key Ratios – Expense Ratios" },
  { category: "r_score",      suffix: "g", title: "Key Ratios – R' Score Components" },
  { category: "return",       suffix: "h", title: "Key Ratios – Return Ratios" },
];

export function KeyRatiosCard({ ratios, pageNumStart, template, generating, onGenerate }: KeyRatiosCardProps) {
  return (
    <>
      {CATEGORIES.map((cat, idx) => (
        <RatioCategoryPanel
          key={cat.category}
          roman="VII"
          romanSuffix={cat.suffix}
          title={cat.title}
          pageNum={pageNumStart + idx}
          category={cat.category}
          ratios={ratios}
        />
      ))}

      {/* VII-i: Analysis Commentary */}
      <SlideShell roman="VII-i" title="Key Ratios – Analysis Commentary" pageNum={pageNumStart + 8} generating={generating} onGenerate={template?.generated_at ? onGenerate : undefined}>
        {template?.generated_at ? (
          <div style={{ fontFamily: DS.bodyFont }}>
            {/* Rows format (new — key-value table) */}
            {(template.rows ?? []).length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {(template.rows ?? []).map((row, i) => (
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
            {!(template.rows ?? []).length && (template.headline || (template.bullets ?? []).length > 0) && (
              <div style={{ padding: "20px 24px" }}>
                {template.headline && <div style={{ fontSize: 13, fontStyle: "italic", color: DS.body, marginBottom: 12 }}>{template.headline}</div>}
                {(template.bullets ?? []).map((b: string, i: number) => (
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
                {(template.flags as string[]).map((f, i) => (
                  <div key={i} style={{ fontSize: 10.5, color: "#B45309", marginBottom: 4, display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.55 }}>
                    <span style={{ flexShrink: 0 }}>⚠</span><span>{f}</span>
                  </div>
                ))}
              </div>
            )}
            {/* Empty fallback */}
            {!(template.rows ?? []).length && !(template.bullets ?? []).length && !(template.flags ?? []).length && (
              <div style={{ padding: "24px", textAlign: "center", fontSize: 11, color: DS.muted, fontStyle: "italic" }}>
                Generation returned no content — click Generate in the header to retry.
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
